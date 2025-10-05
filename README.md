# Atomic Assets API Stress Testing Tool

A streamlined stress testing tool for Atomic Assets API endpoints on the WAX Blockchain with realistic traffic patterns and comprehensive response time analysis.

## Features

- Test multiple Atomic Assets API endpoints with configurable weight distribution
- Support for advanced traffic patterns:
  - **Ramp scenario**: Multi-phase traffic with gradual increases and periodic spikes
  - **Chaos scenario**: Stress testing with overload conditions and stability monitoring
  - **Burst scenario**: Alternating periods of higher and lower traffic with cooldown
  - **Steady scenario**: Baseline performance testing with consistent load
- Smart rate limit detection and handling
- Realistic traffic pacing to better simulate real-world conditions
- Detailed response time analytics:
  - Overall response time statistics (min, max, avg, percentiles)
  - Per-endpoint performance metrics
  - Identification of fastest and slowest endpoints
  - Detailed information about fastest and slowest individual requests

## Requirements

- [Bun](https://bun.sh/) runtime

## Installation

1. Clone this repository:

```
git clone https://github.com/qaraqol/atompulse.git
cd atompulse
```

2. Install dependencies:

```
bun install
```

The only dependencies are:

- commander (for CLI options)
- chalk (for colored output)
- ora (for progress spinners)

## Usage

### Basic Usage

```
bun run stress-test.js --config config.json
```

### Command-Line Options

```
Options:
  -V, --version         output the version number
  -c, --config <path>   path to configuration file (required)
  -u, --url <url>       API URL to test (overrides config)
  -s, --scenario <n>    specific scenario to run
  -v, --verbose         enable verbose output
  -h, --help            display help for command
```

## Configuration File

The configuration file uses a JSON format with the following structure:

```json
{
  "apiUrl": "https://atomic-wax.qaraqol.com",
  "concurrency": 20,
  "verbose": true,
  "collections": ["farmersworld", "alien.worlds", "gpk.topps"],
  "endpoints": [...],
  "scenarios": [...]
}
```

### Advanced Scenario Types

#### Ramp Scenario

Simulates daily traffic patterns with phases of different intensities and random variations:

```json
{
  "type": "ramp",
  "name": "Daily Traffic Pattern",
  "phases": [
    {
      "duration": 300,
      "target": 10,
      "variation": 0.2,
      "description": "Gradual morning increase"
    },
    {
      "duration": 600,
      "target": 25,
      "spikeFrequency": 120,
      "spikeHeight": 60,
      "description": "Business hours with hourly spikes"
    }
  ]
}
```

#### Chaos Scenario

Tests system resilience with periods of extreme overload followed by recovery monitoring:

```json
{
  "type": "chaos",
  "name": "Failure Mode Testing",
  "stages": [
    {
      "action": "overload",
      "targetRPS": 100,
      "duration": 60,
      "description": "Massive traffic spike"
    },
    {
      "action": "sustain",
      "duration": 120,
      "targetRPS": 20,
      "monitorStability": true,
      "description": "Recovery monitoring"
    }
  ]
}
```

#### Burst Scenario

Creates alternating periods of high and low traffic to test how the system handles bursts:

```json
{
  "type": "burst",
  "name": "Burst Traffic Testing",
  "bursts": [
    {
      "duration": 30,
      "requestsPerSecond": 20,
      "cooldown": 15
    },
    {
      "duration": 45,
      "requestsPerSecond": 40,
      "cooldown": 20
    },
    {
      "duration": 30,
      "requestsPerSecond": 60
    }
  ]
}
```

#### Steady Scenario

Establishes baseline performance with a constant load over time:

```json
{
  "type": "steady",
  "name": "Baseline Performance",
  "duration": 300,
  "requestsPerSecond": 10,
  "description": "Steady baseline traffic to establish performance metrics"
}
```

## Reports

The tool generates three types of reports in a timestamped directory:

1. **summary.json** - Key metrics in a structured format for programmatic analysis
2. **detailed.json** - Complete results data for in-depth investigation
3. **report.txt** - Human-readable summary of test results

Reports include:

- Overall success rate and response times
- Min, max, and average response times across all requests
- Fastest and slowest individual requests with details
- Per-endpoint performance metrics with min/max/avg times
- Ranked lists of fastest and slowest endpoints
- Status code distribution
- Rate limit detection

## Sample Output

The tool generates detailed response time analytics that look like this:

```
=== Response Times (ms) ===
Average: 125.5
Min: 42.3
Max: 987.6
Median (P50): 118.2
P95: 325.7
P99: 652.1

=== Fastest Request ===
Endpoint: collections
URL: https://atomic-wax.qaraqol.com/atomicassets/v1/collections?limit=100
Response time: 42.3 ms
Status: 200

=== Slowest Request ===
Endpoint: asset_by_id
URL: https://atomic-wax.qaraqol.com/atomicassets/v1/assets/1099511628001
Response time: 987.6 ms
Status: 200

=== Slowest Endpoints (by avg) ===
1. asset_by_id: 245.3ms avg (320 requests)
2. templates: 156.8ms avg (230 requests)
3. schemas: 134.2ms avg (230 requests)

=== Fastest Endpoints (by avg) ===
1. collections: 88.7ms avg (150 requests)
2. assets: 112.4ms avg (630 requests)
3. schemas: 134.2ms avg (230 requests)
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
