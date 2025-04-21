#!/usr/bin/env bun

/**
 * AtomPulse
 * Atomic Assets API Stress Testing Tool
 *
 * A streamlined command-line tool to stress test Atomic Assets API endpoints
 * on WAX Blockchain with realistic traffic patterns
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { program } from "commander";
import chalk from "chalk";
import ora from "ora";

program
  .version("1.0.0")
  .description("Atomic Assets API Stress Testing Tool")
  .option("-c, --config <path>", "path to configuration file")
  .option("-u, --url <url>", "API URL to test")
  .option("-s, --scenario <n>", "specific scenario to run")
  .option("-v, --verbose", "enable verbose output")
  .parse(process.argv);

const options = program.opts();

// Load configuration
let config;
if (options.config) {
  try {
    if (!existsSync(options.config)) {
      console.error(chalk.red(`Config file not found: ${options.config}`));
      process.exit(1);
    }

    const configFile = readFileSync(options.config, "utf8");
    config = JSON.parse(configFile);
  } catch (err) {
    console.error(chalk.red(`Error loading config file: ${err.message}`));
    process.exit(1);
  }
} else {
  console.error(
    chalk.red("Config file is required. Use --config to specify the path.")
  );
  process.exit(1);
}

// Override config with command line options
if (options.url) config.apiUrl = options.url;
if (options.verbose) config.verbose = true;

// Validate configuration
try {
  validateConfig(config);
} catch (err) {
  console.error(chalk.red(`Invalid configuration: ${err.message}`));
  process.exit(1);
}

// Filter scenarios if specified
if (options.scenario) {
  const filteredScenarios = config.scenarios.filter(
    (s) => s.name === options.scenario
  );
  if (filteredScenarios.length === 0) {
    console.error(
      chalk.red(`No scenario found with name: ${options.scenario}`)
    );
    process.exit(1);
  }
  config.scenarios = filteredScenarios;
}

// Main execution logic
async function main() {
  console.log(chalk.green("=== Atomic Assets API Stress Testing Tool ==="));
  console.log(chalk.gray(`Target API: ${config.apiUrl}`));

  // Prepare test data
  const spinner = ora("Preparing test data...").start();
  const testData = await prepareTestData();
  spinner.succeed("Test data prepared");

  // Run each scenario and collect results
  const scenarioResults = [];
  for (const scenario of config.scenarios) {
    const runner = getScenarioRunner(scenario.type);
    const result = await runner(scenario, testData);
    scenarioResults.push({ scenario, ...result });
  }

  // Generate final report
  generateReport(scenarioResults);
}

/**
 * Validates the configuration object
 */
function validateConfig(config) {
  if (!config.apiUrl) {
    throw new Error("apiUrl is required in config");
  }

  try {
    new URL(config.apiUrl);
  } catch (e) {
    throw new Error(`Invalid apiUrl: ${config.apiUrl}`);
  }

  if (
    !config.endpoints ||
    !Array.isArray(config.endpoints) ||
    config.endpoints.length === 0
  ) {
    throw new Error("At least one endpoint must be defined in config");
  }

  if (
    !config.scenarios ||
    !Array.isArray(config.scenarios) ||
    config.scenarios.length === 0
  ) {
    throw new Error("At least one scenario must be defined in config");
  }
}

/**
 * Prepares test data including sample IDs for dynamic parameters
 */
async function prepareTestData() {
  const testData = {
    assetIds: [],
    collections: [],
    endpoints: {},
  };

  // Convert endpoints to a more usable format with weights
  const endpointsArray = [];
  config.endpoints.forEach((endpoint) => {
    const weight = endpoint.weight || 1;
    for (let i = 0; i < weight; i++) {
      endpointsArray.push(endpoint);
    }

    testData.endpoints[endpoint.name] = endpoint;
  });
  testData.weightedEndpoints = endpointsArray;

  // Get collections from config or fetch them if not provided
  if (
    config.collections &&
    Array.isArray(config.collections) &&
    config.collections.length > 0
  ) {
    testData.collections = config.collections;
  } else {
    // Import the fetchCollections function
    try {
      const { fetchCollections } = await import("./fetchCollections.js");
      testData.collections = await fetchCollections(5);
    } catch (error) {
      console.warn(`Failed to import fetchCollections: ${error.message}`);
      testData.collections = [
        "farmersworld",
        "alien.worlds",
        "atomicmarket",
        "atomichub",
        "gpk.topps",
      ];
    }
  }

  // Get sample asset IDs if needed
  const assetIdEndpoint = config.endpoints.find(
    (e) => e.name === "asset_by_id" || e.path.includes("{asset_id}")
  );
  if (assetIdEndpoint) {
    if (assetIdEndpoint.sampleIds && assetIdEndpoint.sampleIds.length > 0) {
      testData.assetIds = assetIdEndpoint.sampleIds;
    } else {
      // Try to fetch asset IDs from collections
      for (const collection of testData.collections) {
        try {
          const response = await fetch(
            `${config.apiUrl}/atomicassets/v1/assets?collection_name=${collection}&limit=50`
          );
          if (response.ok) {
            const data = await response.json();
            if (data.data && Array.isArray(data.data)) {
              testData.assetIds = testData.assetIds.concat(
                data.data.map((asset) => asset.asset_id)
              );

              if (testData.assetIds.length >= 100) {
                break;
              }
            }
          }
        } catch (e) {
          // Continue to next collection
        }
      }

      // Fallback to generic assets request if needed
      if (testData.assetIds.length === 0) {
        try {
          const response = await fetch(
            `${config.apiUrl}/atomicassets/v1/assets?limit=100`
          );
          if (response.ok) {
            const data = await response.json();
            if (data.data && Array.isArray(data.data)) {
              testData.assetIds = data.data.map((asset) => asset.asset_id);
            }
          }
        } catch (e) {
          // Use mock IDs as last resort
          testData.assetIds = Array.from({ length: 100 }, (_, i) => {
            const base = 1099511627776; // 2^40
            return (base + i).toString();
          });
        }
      }
    }
  }

  return testData;
}

/**
 * Gets the appropriate scenario runner based on scenario type
 */
function getScenarioRunner(type) {
  const runners = {
    ramp: runRampScenario,
    chaos: runChaosScenario,
    steady: runSteadyScenario,
    burst: runBurstScenario,
  };

  return runners[type] || runSteadyScenario;
}

/**
 * Builds a request URL for a given endpoint
 */
function buildRequestUrl(endpoint, testData) {
  let url = `${config.apiUrl}${endpoint.path}`;

  // Handle dynamic path parameters
  if (url.includes("{asset_id}") && testData.assetIds.length > 0) {
    const randomId =
      testData.assetIds[Math.floor(Math.random() * testData.assetIds.length)];
    url = url.replace("{asset_id}", randomId);
  }

  // Add query parameters
  if (endpoint.params && Object.keys(endpoint.params).length > 0) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(endpoint.params)) {
      query.append(key, value);
    }
    url += `?${query.toString()}`;
  }

  return url;
}

/**
 * Executes a single request and returns timing and status information
 */
async function executeRequest(endpoint, testData) {
  const url = buildRequestUrl(endpoint, testData);
  const startTime = performance.now();
  const timestamp = new Date().toISOString();

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "Atomic-Assets-Stress-Test/1.0",
      },
    });

    const endTime = performance.now();
    const duration = endTime - startTime;

    // Check for rate limits
    const rateLimited = response.status === 429;

    // Check various rate limit header formats
    const rateLimit = {
      limit: parseInt(
        response.headers.get("x-ratelimit-limit") ||
          response.headers.get("ratelimit-limit") ||
          "0",
        10
      ),
      remaining: parseInt(
        response.headers.get("x-ratelimit-remaining") ||
          response.headers.get("ratelimit-remaining") ||
          "0",
        10
      ),
      reset: parseInt(
        response.headers.get("x-ratelimit-reset") ||
          response.headers.get("ratelimit-reset") ||
          "0",
        10
      ),
      retryAfter: parseInt(response.headers.get("retry-after") || "0", 10),
    };

    // Get response data size
    let size = 0;
    try {
      const text = await response.text();
      size = text.length;
    } catch (e) {
      // Ignore errors when reading response body
    }

    return {
      url,
      endpoint: endpoint.name,
      status: response.status,
      duration,
      rateLimited,
      rateLimit,
      size,
      timestamp,
      success: response.ok,
    };
  } catch (err) {
    const endTime = performance.now();
    const duration = endTime - startTime;

    return {
      url,
      endpoint: endpoint.name,
      status: 0,
      duration,
      error: err.message,
      rateLimited: false,
      rateLimit: { limit: 0, remaining: 0, reset: 0 },
      size: 0,
      timestamp,
      success: false,
    };
  }
}

/**
 * Handles rate limiting by tracking rate limit state
 */
class RateLimitTracker {
  constructor() {
    this.limitedEndpoints = new Map();
  }

  isLimited(endpoint) {
    const now = Date.now();
    const info = this.limitedEndpoints.get(endpoint.path);
    return info && info.resetAt > now;
  }

  markLimited(result) {
    if (result.rateLimited) {
      const resetDelay = result.rateLimit.retryAfter
        ? result.rateLimit.retryAfter * 1000
        : result.rateLimit.reset
        ? result.rateLimit.reset * 1000
        : 5000;

      this.limitedEndpoints.set(result.url.pathname, {
        resetAt: Date.now() + resetDelay,
        limit: result.rateLimit.limit,
        remaining: result.rateLimit.remaining,
      });

      return true;
    }
    return false;
  }

  getEndpoint(testData) {
    const now = Date.now();
    // Clean up expired entries
    this.limitedEndpoints.forEach((info, key) => {
      if (info.resetAt <= now) {
        this.limitedEndpoints.delete(key);
      }
    });

    // Find an endpoint that's not rate limited
    let attempts = 0;
    let endpoint;

    do {
      endpoint =
        testData.weightedEndpoints[
          Math.floor(Math.random() * testData.weightedEndpoints.length)
        ];
      if (!this.isLimited(endpoint)) {
        return endpoint;
      }
      attempts++;
    } while (attempts < 5);

    // Return any endpoint if all are rate limited
    return testData.weightedEndpoints[0];
  }
}

/**
 * Runs a ramp scenario with multiple phases
 */
async function runRampScenario(scenario, testData) {
  console.log(chalk.cyan(`\nRunning "${scenario.name}" (type: ramp)`));

  const results = [];
  const rateLimitTracker = new RateLimitTracker();
  const startTime = performance.now();
  const spinner = ora(`Running test...`).start();

  // Run each phase
  for (let phaseIndex = 0; phaseIndex < scenario.phases.length; phaseIndex++) {
    const phase = scenario.phases[phaseIndex];
    spinner.text = `Phase ${phaseIndex + 1}/${scenario.phases.length}: ${
      phase.description || ""
    }`;

    // Setting up phase parameters
    const phaseDuration = phase.duration * 1000; // convert to ms
    const phaseStartTime = performance.now();
    const phaseEndTime = phaseStartTime + phaseDuration;
    const baseRPS = phase.target || 10;
    const variation = phase.variation || 0;

    // For phases with spikes
    const spikeInterval = phase.spikeFrequency
      ? phase.spikeFrequency * 1000
      : null;
    const spikeHeight = phase.spikeHeight || 0;
    let nextSpikeTime = spikeInterval
      ? phaseStartTime + spikeInterval
      : Infinity;
    let inSpike = false;
    let spikeEndTime = 0;
    const spikeDuration = 5000; // 5 seconds per spike

    // Keep track of request scheduling
    let requestCount = 0;
    let lastRequestTime = 0;

    // Continue until phase duration is complete
    while (performance.now() < phaseEndTime) {
      // Check if we should enter or exit a spike
      const currentTime = performance.now();

      if (spikeInterval && !inSpike && currentTime >= nextSpikeTime) {
        inSpike = true;
        spikeEndTime = currentTime + spikeDuration;
        spinner.text = `Phase ${phaseIndex + 1}: SPIKE (${spikeHeight} RPS)`;
      } else if (inSpike && currentTime >= spikeEndTime) {
        inSpike = false;
        nextSpikeTime = currentTime + spikeInterval;
        spinner.text = `Phase ${phaseIndex + 1}: ${
          phase.description || ""
        } (${baseRPS} RPS)`;
      }

      // Calculate current RPS target with variation
      let currentRPS = baseRPS;

      if (inSpike) {
        currentRPS = spikeHeight;
      } else if (variation) {
        // Add random variation within the specified percentage
        const variationFactor = 1 + (Math.random() * 2 - 1) * variation;
        currentRPS = baseRPS * variationFactor;
      }

      // Calculate request interval in ms
      const requestInterval = 1000 / currentRPS;

      // Check if it's time to send another request
      if (currentTime - lastRequestTime >= requestInterval) {
        // Get an endpoint that's not rate limited
        const endpoint = rateLimitTracker.getEndpoint(testData);

        // Execute the request (don't await to allow concurrency)
        executeRequest(endpoint, testData).then((result) => {
          results.push(result);
          rateLimitTracker.markLimited(result);

          // Update progress display every 10 requests
          if (results.length % 10 === 0) {
            const progress = Math.min(
              100,
              Math.round(((currentTime - phaseStartTime) / phaseDuration) * 100)
            );
            spinner.text = `Phase ${phaseIndex + 1}/${
              scenario.phases.length
            }: ${progress}% complete, ${results.length} requests`;
          }
        });

        lastRequestTime = currentTime;
        requestCount++;

        // Add a small delay to avoid overwhelming the event loop
        await new Promise((resolve) => setTimeout(resolve, 1));
      } else {
        // Sleep to reduce CPU usage when waiting for next request time
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(10, requestInterval / 2))
        );
      }
    }

    // Wait for any pending requests to complete
    spinner.text = `Waiting for ${Math.max(
      0,
      requestCount - results.length
    )} pending requests to complete...`;
    while (results.length < requestCount) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const totalDuration = (performance.now() - startTime) / 1000;
  spinner.succeed(
    `Test completed in ${totalDuration.toFixed(2)}s with ${
      results.length
    } total requests`
  );

  return { results, totalDuration };
}
/**
 * Runs a chaos scenario with multiple destructive stages - Fixed to avoid stack overflow
 */
async function runChaosScenario(scenario, testData) {
  console.log(chalk.cyan(`\nRunning "${scenario.name}" (type: chaos)`));

  const results = [];
  const rateLimitTracker = new RateLimitTracker();
  const startTime = performance.now();
  const spinner = ora(`Running test...`).start();

  // Track system stability
  let systemStable = true;
  let lastSuccessfulRequest = Date.now();
  const stabilityThreshold = 5000; // 5 seconds without successful response = instability

  // Run each stage
  for (let stageIndex = 0; stageIndex < scenario.stages.length; stageIndex++) {
    const stage = scenario.stages[stageIndex];
    spinner.text = `Stage ${stageIndex + 1}/${scenario.stages.length}: ${
      stage.description || stage.action
    }`;

    // Setting up stage parameters
    const stageDuration = stage.duration * 1000; // convert to ms
    const stageStartTime = performance.now();
    const stageEndTime = stageStartTime + stageDuration;
    const targetRPS = stage.targetRPS || 10;
    const monitorStability = !!stage.monitorStability;

    // To avoid stack overflow, we'll use a queue-based approach with batching
    const maxConcurrentRequests = 100; // Limit concurrent requests
    const requestQueue = [];
    let activeRequests = 0;
    let requestCount = 0;
    let lastRequestTime = 0;

    // A function to process the next batch of requests from the queue
    const processQueue = async () => {
      while (
        requestQueue.length > 0 &&
        activeRequests < maxConcurrentRequests
      ) {
        const endpoint = requestQueue.shift();
        activeRequests++;

        // Execute the request
        executeRequest(endpoint, testData)
          .then((result) => {
            results.push(result);
            activeRequests--;

            // For sustain action, track rate limits
            if (stage.action === "sustain") {
              rateLimitTracker.markLimited(result);
            }

            // Track system stability
            if (monitorStability) {
              if (result.success) {
                lastSuccessfulRequest = Date.now();
                if (!systemStable) {
                  spinner.text = `Stage ${stageIndex + 1}: System recovered`;
                  systemStable = true;
                }
              } else {
                // Check if we've exceeded the stability threshold
                const timeSinceSuccess = Date.now() - lastSuccessfulRequest;
                if (systemStable && timeSinceSuccess > stabilityThreshold) {
                  spinner.text = `Stage ${
                    stageIndex + 1
                  }: SYSTEM UNSTABLE - ${timeSinceSuccess}ms without success`;
                  systemStable = false;
                }
              }
            }
          })
          .catch((error) => {
            console.error(`Error executing request: ${error.message}`);
            activeRequests--;
          });
      }
    };

    // Continue until stage duration is complete
    while (performance.now() < stageEndTime) {
      const currentTime = performance.now();

      // Calculate request interval in ms
      const requestInterval = 1000 / targetRPS;

      // Check if it's time to add more requests to the queue
      if (currentTime - lastRequestTime >= requestInterval) {
        // For overload action, queue multiple requests at once
        const requestsToQueue =
          stage.action === "overload"
            ? Math.min(
                10,
                maxConcurrentRequests - requestQueue.length - activeRequests
              )
            : 1;

        for (let i = 0; i < requestsToQueue; i++) {
          // Get an endpoint that's not rate limited (for sustain action only)
          const endpoint =
            stage.action === "sustain"
              ? rateLimitTracker.getEndpoint(testData)
              : testData.weightedEndpoints[
                  Math.floor(Math.random() * testData.weightedEndpoints.length)
                ];

          // Add to queue
          requestQueue.push(endpoint);
          requestCount++;
        }

        lastRequestTime = currentTime;

        // Process queued requests
        processQueue();

        // Update progress display periodically
        if (results.length % 50 === 0 || results.length % 50 === 1) {
          const progress = Math.min(
            100,
            Math.round(((currentTime - stageStartTime) / stageDuration) * 100)
          );
          spinner.text = `Stage ${stageIndex + 1}: ${progress}% complete, ${
            results.length
          }/${requestCount} requests, ${activeRequests} active`;
        }

        // Add a small delay to avoid overwhelming the event loop
        await new Promise((resolve) => setTimeout(resolve, 5));
      } else {
        // Sleep to reduce CPU usage when waiting for next request time
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(10, requestInterval / 2))
        );
      }
    }

    // Give up to 30 seconds for queued/active requests to complete
    spinner.text = `Waiting for ${
      requestQueue.length + activeRequests
    } pending requests to complete...`;
    const waitStart = Date.now();
    const maxWait = 30000; // 30 seconds max wait

    while (
      (requestQueue.length > 0 || activeRequests > 0) &&
      Date.now() - waitStart < maxWait
    ) {
      // Continue processing the queue
      processQueue();

      // Update spinner periodically
      if (Date.now() % 1000 < 50) {
        spinner.text = `Waiting for ${
          requestQueue.length + activeRequests
        } pending requests (${results.length}/${requestCount} completed)...`;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // If we timed out waiting for requests, note it
    if (requestQueue.length > 0 || activeRequests > 0) {
      const remaining = requestQueue.length + activeRequests;
      const completed = results.length;
      const total = requestCount;
      spinner.warn(
        `Timed out waiting for ${remaining} requests (${completed}/${total} completed)`
      );
    }
  }

  const totalDuration = (performance.now() - startTime) / 1000;
  spinner.succeed(
    `Test completed in ${totalDuration.toFixed(2)}s with ${
      results.length
    } total requests`
  );

  return { results, totalDuration };
}

/**
 * Runs a steady load scenario
 */
async function runSteadyScenario(scenario, testData) {
  console.log(chalk.cyan(`\nRunning "${scenario.name}" (type: steady)`));

  const results = [];
  const rateLimitTracker = new RateLimitTracker();
  const startTime = performance.now();
  const spinner = ora(`Running test...`).start();

  // Setting up scenario parameters
  const duration = (scenario.duration || 30) * 1000; // convert to ms
  const endTime = startTime + duration;
  const targetRPS = scenario.requestsPerSecond || 10;
  const requestInterval = 1000 / targetRPS;

  // Keep track of request scheduling
  let requestCount = 0;
  let lastRequestTime = 0;

  // Continue until duration is complete
  while (performance.now() < endTime) {
    const currentTime = performance.now();

    // Check if it's time to send another request
    if (currentTime - lastRequestTime >= requestInterval) {
      // Get an endpoint that's not rate limited
      const endpoint = rateLimitTracker.getEndpoint(testData);

      // Execute the request (don't await to allow concurrency)
      executeRequest(endpoint, testData).then((result) => {
        results.push(result);
        rateLimitTracker.markLimited(result);

        // Update progress display periodically
        if (results.length % 10 === 0) {
          const progress = Math.min(
            100,
            Math.round(((currentTime - startTime) / duration) * 100)
          );
          spinner.text = `Progress: ${progress}%, ${results.length} requests`;
        }
      });

      lastRequestTime = currentTime;
      requestCount++;

      // Add a small delay to avoid overwhelming the event loop
      await new Promise((resolve) => setTimeout(resolve, 1));
    } else {
      // Sleep to reduce CPU usage when waiting for next request time
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(10, requestInterval / 2))
      );
    }
  }

  // Wait for any pending requests to complete
  spinner.text = `Waiting for ${Math.max(
    0,
    requestCount - results.length
  )} pending requests to complete...`;
  while (results.length < requestCount) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const totalDuration = (performance.now() - startTime) / 1000;
  spinner.succeed(
    `Test completed in ${totalDuration.toFixed(2)}s with ${
      results.length
    } total requests`
  );

  return { results, totalDuration };
}

/**
 * Runs a burst scenario with alternating loads
 */
async function runBurstScenario(scenario, testData) {
  console.log(chalk.cyan(`\nRunning "${scenario.name}" (type: burst)`));

  const results = [];
  const rateLimitTracker = new RateLimitTracker();
  const startTime = performance.now();
  const spinner = ora(`Running test...`).start();

  // Setting up scenario parameters
  const bursts = scenario.bursts || [
    { duration: 10, requestsPerSecond: 100, cooldown: 5 },
    { duration: 10, requestsPerSecond: 200, cooldown: 5 },
  ];

  // Run each burst
  for (let burstIndex = 0; burstIndex < bursts.length; burstIndex++) {
    const burst = bursts[burstIndex];
    spinner.text = `Burst ${burstIndex + 1}/${bursts.length}: ${
      burst.requestsPerSecond
    } RPS for ${burst.duration}s`;

    // Setting up burst parameters
    const burstDuration = burst.duration * 1000; // convert to ms
    const burstStartTime = performance.now();
    const burstEndTime = burstStartTime + burstDuration;
    const targetRPS = burst.requestsPerSecond;
    const requestInterval = 1000 / targetRPS;

    // Keep track of request scheduling
    let requestCount = 0;
    let lastRequestTime = 0;

    // Continue until burst duration is complete
    while (performance.now() < burstEndTime) {
      const currentTime = performance.now();

      // Check if it's time to send another request
      if (currentTime - lastRequestTime >= requestInterval) {
        // Get an endpoint that's not rate limited
        const endpoint = rateLimitTracker.getEndpoint(testData);

        // Execute the request (don't await to allow concurrency)
        executeRequest(endpoint, testData).then((result) => {
          results.push(result);
          rateLimitTracker.markLimited(result);

          // Update progress display periodically
          if (results.length % 10 === 0) {
            const progress = Math.min(
              100,
              Math.round(((currentTime - burstStartTime) / burstDuration) * 100)
            );
            spinner.text = `Burst ${burstIndex + 1}: ${progress}%, ${
              results.length
            } requests`;
          }
        });

        lastRequestTime = currentTime;
        requestCount++;

        // Add a small delay to avoid overwhelming the event loop
        await new Promise((resolve) => setTimeout(resolve, 1));
      } else {
        // Sleep to reduce CPU usage when waiting for next request time
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(10, requestInterval / 2))
        );
      }
    }

    // Wait for any pending requests to complete
    spinner.text = `Waiting for ${Math.max(
      0,
      requestCount - results.length
    )} pending requests to complete...`;
    while (results.length < requestCount) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Apply cooldown period if specified and not the last burst
    if (burst.cooldown && burstIndex < bursts.length - 1) {
      spinner.text = `Cooling down for ${burst.cooldown}s...`;
      await new Promise((resolve) =>
        setTimeout(resolve, burst.cooldown * 1000)
      );
    }
  }

  const totalDuration = (performance.now() - startTime) / 1000;
  spinner.succeed(
    `Test completed in ${totalDuration.toFixed(2)}s with ${
      results.length
    } total requests`
  );

  return { results, totalDuration };
}

/**
 * Generates a concise report
 */
function generateReport(scenarioResults) {
  console.log(
    chalk.green("\n========== Atomic Assets API Stress Test Report ==========")
  );
  console.log(chalk.gray(`Target API: ${config.apiUrl}`));
  console.log(chalk.gray(`Test run at: ${new Date().toISOString()}`));

  // Combine all results for overall metrics
  const allResults = [];
  scenarioResults.forEach((result) => {
    allResults.push(...result.results);
  });

  // Calculate overall metrics
  const totalRequests = allResults.length;
  const successfulRequests = allResults.filter((r) => r.success).length;
  const errorRequests = totalRequests - successfulRequests;
  const rateLimitedRequests = allResults.filter((r) => r.rateLimited).length;

  // Response time metrics
  const durations = allResults.map((r) => r.duration);
  durations.sort((a, b) => a - b);

  const avgDuration =
    durations.reduce((sum, d) => sum + d, 0) / durations.length;
  const minDuration = durations[0] || 0;
  const maxDuration = durations[durations.length - 1] || 0;
  const p50 = durations[Math.floor(durations.length * 0.5)] || 0;
  const p95 = durations[Math.floor(durations.length * 0.95)] || 0;
  const p99 = durations[Math.floor(durations.length * 0.99)] || 0;

  // Find fastest and slowest requests
  let fastestRequest = null;
  let slowestRequest = null;

  allResults.forEach((result) => {
    if (!fastestRequest || result.duration < fastestRequest.duration) {
      fastestRequest = result;
    }
    if (!slowestRequest || result.duration > slowestRequest.duration) {
      slowestRequest = result;
    }
  });

  // Output summary metrics
  console.log(chalk.cyan("\n=== Summary ==="));
  console.log(`Total requests: ${totalRequests}`);
  console.log(
    `Success rate: ${((successfulRequests / totalRequests) * 100).toFixed(1)}%`
  );
  console.log(
    `Rate limited: ${((rateLimitedRequests / totalRequests) * 100).toFixed(1)}%`
  );

  console.log(chalk.cyan("\n=== Response Times (ms) ==="));
  console.log(`Average: ${avgDuration.toFixed(1)}`);
  console.log(`Min: ${minDuration.toFixed(1)}`);
  console.log(`Max: ${maxDuration.toFixed(1)}`);
  console.log(`Median (P50): ${p50.toFixed(1)}`);
  console.log(`P95: ${p95.toFixed(1)}`);
  console.log(`P99: ${p99.toFixed(1)}`);

  // Display fastest and slowest requests
  if (fastestRequest) {
    console.log(chalk.cyan("\n=== Fastest Request ==="));
    console.log(`Endpoint: ${fastestRequest.endpoint}`);
    console.log(`URL: ${fastestRequest.url}`);
    console.log(`Response time: ${fastestRequest.duration.toFixed(1)} ms`);
    console.log(`Status: ${fastestRequest.status}`);
  }

  if (slowestRequest) {
    console.log(chalk.cyan("\n=== Slowest Request ==="));
    console.log(`Endpoint: ${slowestRequest.endpoint}`);
    console.log(`URL: ${slowestRequest.url}`);
    console.log(`Response time: ${slowestRequest.duration.toFixed(1)} ms`);
    console.log(`Status: ${slowestRequest.status}`);
  }

  // Per-endpoint metrics
  console.log(chalk.cyan("\n=== Endpoint Performance ==="));

  const endpointStats = {};
  allResults.forEach((result) => {
    if (!endpointStats[result.endpoint]) {
      endpointStats[result.endpoint] = {
        requests: 0,
        successful: 0,
        errors: 0,
        rateLimited: 0,
        durations: [],
      };
    }

    endpointStats[result.endpoint].requests++;
    if (result.success) endpointStats[result.endpoint].successful++;
    else endpointStats[result.endpoint].errors++;
    if (result.rateLimited) endpointStats[result.endpoint].rateLimited++;
    endpointStats[result.endpoint].durations.push(result.duration);
  });

  // Display metrics for each endpoint
  console.log(chalk.cyan("\n=== Endpoint Performance ==="));
  const endpointPerformance = [];

  Object.entries(endpointStats).forEach(([endpoint, stats]) => {
    const successRate = ((stats.successful / stats.requests) * 100).toFixed(1);
    const avgTime = (
      stats.durations.reduce((sum, d) => sum + d, 0) / stats.durations.length
    ).toFixed(1);
    const minTime = Math.min(...stats.durations).toFixed(1);
    const maxTime = Math.max(...stats.durations).toFixed(1);

    endpointPerformance.push({
      endpoint,
      requests: stats.requests,
      successRate,
      avgTime,
      minTime,
      maxTime,
    });

    console.log(
      `${endpoint}: ${stats.requests} requests, ${successRate}% success, avg=${avgTime}ms, min=${minTime}ms, max=${maxTime}ms`
    );
  });

  // Sort endpoints by average response time
  endpointPerformance.sort(
    (a, b) => parseFloat(b.avgTime) - parseFloat(a.avgTime)
  );

  // Show top 3 slowest endpoints
  if (endpointPerformance.length > 0) {
    console.log(chalk.cyan("\n=== Slowest Endpoints (by avg) ==="));
    endpointPerformance
      .slice(0, Math.min(3, endpointPerformance.length))
      .forEach((ep, index) => {
        console.log(
          `${index + 1}. ${ep.endpoint}: ${ep.avgTime}ms avg (${
            ep.requests
          } requests)`
        );
      });
  }

  // Show top 3 fastest endpoints
  if (endpointPerformance.length > 0) {
    console.log(chalk.cyan("\n=== Fastest Endpoints (by avg) ==="));
    [...endpointPerformance]
      .sort((a, b) => parseFloat(a.avgTime) - parseFloat(b.avgTime))
      .slice(0, Math.min(3, endpointPerformance.length))
      .forEach((ep, index) => {
        console.log(
          `${index + 1}. ${ep.endpoint}: ${ep.avgTime}ms avg (${
            ep.requests
          } requests)`
        );
      });
  }

  // Status code breakdown
  const statusCodes = {};
  allResults.forEach((r) => {
    const status = r.status || 0;
    statusCodes[status] = (statusCodes[status] || 0) + 1;
  });

  console.log(chalk.cyan("\n=== Status Codes ==="));
  Object.entries(statusCodes)
    .sort((a, b) => b[1] - a[1])
    .forEach(([code, count]) => {
      const pct = ((count / totalRequests) * 100).toFixed(1);
      let label = code;

      if (code === "0") label = "0 (Network Error)";
      if (code === "200") label = "200 (OK)";
      if (code === "429") label = "429 (Rate Limited)";
      if (code === "500") label = "500 (Server Error)";

      console.log(`${label}: ${count} (${pct}%)`);
    });

  // Rate limit information
  const rateLimits = new Set();
  allResults.forEach((r) => {
    if (r.rateLimit && r.rateLimit.limit > 0) {
      rateLimits.add(`${r.rateLimit.limit} req/window`);
    }
  });

  if (rateLimits.size > 0) {
    console.log(chalk.cyan("\n=== Rate Limits ==="));
    console.log(`Detected: ${Array.from(rateLimits).join(", ")}`);
  }

  // Per-scenario summary
  console.log(chalk.cyan("\n=== Scenarios ==="));
  scenarioResults.forEach((result, index) => {
    const scenarioRequests = result.results.length;
    const scenarioSuccess = result.results.filter((r) => r.success).length;
    const successRate = ((scenarioSuccess / scenarioRequests) * 100).toFixed(1);

    console.log(
      `${
        result.scenario.name
      }: ${scenarioRequests} requests, ${successRate}% success, ${result.totalDuration.toFixed(
        1
      )}s duration`
    );
  });

  // Save results to file
  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\..+/, "");
  const reportDir = `atomic-stress-test-${timestamp}`;
  let summaryData;
  try {
    mkdirSync(reportDir, { recursive: true });
    // Save summary results as JSON
    const summaryFile = `${reportDir}/summary.json`;
    summaryData = {
      timestamp: new Date().toISOString(),
      apiUrl: config.apiUrl,
      metrics: {
        totalRequests,
        successRate: successfulRequests / totalRequests,
        errorRate: errorRequests / totalRequests,
        rateLimitedRate: rateLimitedRequests / totalRequests,
        responseTimes: {
          avg: avgDuration,
          min: minDuration,
          max: maxDuration,
          p50,
          p95,
          p99,
        },
        fastestRequest: {
          endpoint: fastestRequest?.endpoint,
          url: fastestRequest?.url,
          duration: fastestRequest?.duration,
          status: fastestRequest?.status,
        },
        slowestRequest: {
          endpoint: slowestRequest?.endpoint,
          url: slowestRequest?.url,
          duration: slowestRequest?.duration,
          status: slowestRequest?.status,
        },
      },
      endpoints: Object.entries(endpointStats).map(([name, stats]) => {
        const durations = stats.durations;
        return {
          name,
          requests: stats.requests,
          successRate: stats.successful / stats.requests,
          responseTimes: {
            avg: durations.reduce((sum, d) => sum + d, 0) / durations.length,
            min: Math.min(...durations),
            max: Math.max(...durations),
          },
        };
      }),
      scenarios: scenarioResults.map((result) => ({
        name: result.scenario.name,
        type: result.scenario.type,
        duration: result.totalDuration,
        requests: result.results.length,
        successRate:
          result.results.filter((r) => r.success).length /
          result.results.length,
      })),
    };

    writeFileSync(summaryFile, JSON.stringify(summaryData, null, 2));

    // Save detailed results for analysis
    const detailedFile = `${reportDir}/detailed.json`;
    const detailedData = {
      config,
      results: scenarioResults.map((result) => ({
        scenario: result.scenario,
        duration: result.totalDuration,
        results: result.results.map((r) => ({
          endpoint: r.endpoint,
          url: r.url,
          status: r.status,
          duration: r.duration,
          success: r.success,
          rateLimited: r.rateLimited,
          timestamp: r.timestamp,
        })),
      })),
    };

    writeFileSync(detailedFile, JSON.stringify(detailedData, null, 2));

    // Save human-readable report
    const reportFile = `${reportDir}/report.txt`;
    let reportText = `=== Atomic Assets API Stress Test Report ===\n`;
    reportText += `Target API: ${config.apiUrl}\n`;
    reportText += `Test run at: ${new Date().toISOString()}\n\n`;

    reportText += `=== Summary ===\n`;
    reportText += `Total requests: ${totalRequests}\n`;
    reportText += `Success rate: ${(
      (successfulRequests / totalRequests) *
      100
    ).toFixed(1)}%\n`;
    reportText += `Error rate: ${(
      (errorRequests / totalRequests) *
      100
    ).toFixed(1)}%\n`;
    reportText += `Rate limited: ${(
      (rateLimitedRequests / totalRequests) *
      100
    ).toFixed(1)}%\n\n`;

    reportText += `=== Response Times (ms) ===\n`;
    reportText += `Average: ${avgDuration.toFixed(1)}\n`;
    reportText += `Min: ${minDuration.toFixed(1)}\n`;
    reportText += `Max: ${maxDuration.toFixed(1)}\n`;
    reportText += `Median (P50): ${p50.toFixed(1)}\n`;
    reportText += `P95: ${p95.toFixed(1)}\n`;
    reportText += `P99: ${p99.toFixed(1)}\n\n`;

    // Add fastest and slowest request info
    if (fastestRequest) {
      reportText += `=== Fastest Request ===\n`;
      reportText += `Endpoint: ${fastestRequest.endpoint}\n`;
      reportText += `URL: ${fastestRequest.url}\n`;
      reportText += `Response time: ${fastestRequest.duration.toFixed(1)} ms\n`;
      reportText += `Status: ${fastestRequest.status}\n\n`;
    }

    if (slowestRequest) {
      reportText += `=== Slowest Request ===\n`;
      reportText += `Endpoint: ${slowestRequest.endpoint}\n`;
      reportText += `URL: ${slowestRequest.url}\n`;
      reportText += `Response time: ${slowestRequest.duration.toFixed(1)} ms\n`;
      reportText += `Status: ${slowestRequest.status}\n\n`;
    }

    reportText += `=== Endpoint Performance ===\n`;
    // Sort endpoints by average response time (slowest first)
    const sortedEndpoints = Object.entries(endpointStats)
      .map(([endpoint, stats]) => {
        const avgTime =
          stats.durations.reduce((sum, d) => sum + d, 0) /
          stats.durations.length;
        const minTime = Math.min(...stats.durations);
        const maxTime = Math.max(...stats.durations);
        return { endpoint, stats, avgTime, minTime, maxTime };
      })
      .sort((a, b) => b.avgTime - a.avgTime);

    sortedEndpoints.forEach(
      ({ endpoint, stats, avgTime, minTime, maxTime }) => {
        const successRate = ((stats.successful / stats.requests) * 100).toFixed(
          1
        );
        reportText += `${endpoint}: ${
          stats.requests
        } requests, ${successRate}% success, avg=${avgTime.toFixed(
          1
        )}ms, min=${minTime.toFixed(1)}ms, max=${maxTime.toFixed(1)}ms\n`;
      }
    );

    // Add slowest and fastest endpoints section
    reportText += `\n=== Slowest Endpoints (by avg) ===\n`;
    sortedEndpoints
      .slice(0, Math.min(3, sortedEndpoints.length))
      .forEach((ep, index) => {
        reportText += `${index + 1}. ${ep.endpoint}: ${ep.avgTime.toFixed(
          1
        )}ms avg (${ep.stats.requests} requests)\n`;
      });

    reportText += `\n=== Fastest Endpoints (by avg) ===\n`;
    [...sortedEndpoints]
      .sort((a, b) => a.avgTime - b.avgTime)
      .slice(0, Math.min(3, sortedEndpoints.length))
      .forEach((ep, index) => {
        reportText += `${index + 1}. ${ep.endpoint}: ${ep.avgTime.toFixed(
          1
        )}ms avg (${ep.stats.requests} requests)\n`;
      });

    reportText += `\n=== Status Codes ===\n`;
    Object.entries(statusCodes)
      .sort((a, b) => b[1] - a[1])
      .forEach(([code, count]) => {
        const pct = ((count / totalRequests) * 100).toFixed(1);
        let label = code;

        if (code === "0") label = "0 (Network Error)";
        if (code === "200") label = "200 (OK)";
        if (code === "429") label = "429 (Rate Limited)";
        if (code === "500") label = "500 (Server Error)";

        reportText += `${label}: ${count} (${pct}%)\n`;
      });

    if (rateLimits.size > 0) {
      reportText += `\n=== Rate Limits ===\n`;
      reportText += `Detected: ${Array.from(rateLimits).join(", ")}\n`;
    }

    reportText += `\n=== Scenarios ===\n`;
    scenarioResults.forEach((result, index) => {
      const scenarioRequests = result.results.length;
      const scenarioSuccess = result.results.filter((r) => r.success).length;
      const successRate = ((scenarioSuccess / scenarioRequests) * 100).toFixed(
        1
      );

      reportText += `${
        result.scenario.name
      }: ${scenarioRequests} requests, ${successRate}% success, ${result.totalDuration.toFixed(
        1
      )}s duration\n`;
    });

    writeFileSync(reportFile, reportText);

    console.log(chalk.green(`\nReports saved to ${reportDir}/`));
  } catch (err) {
    console.error(chalk.red(`Error saving reports: ${err.message}`));

    // Fallback to single file
    const reportFile = `atomic-stress-test-report-${timestamp}.json`;
    writeFileSync(reportFile, JSON.stringify(summaryData, null, 2));
    console.log(chalk.yellow(`Fallback report saved to ${reportFile}`));
  }
}

// Start the test
main().catch((err) => {
  console.error(chalk.red(`Error: ${err.message}`));
  process.exit(1);
});
