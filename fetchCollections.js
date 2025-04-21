#!/usr/bin/env bun

/**
 * Fetch Collections Utility
 *
 * This utility fetches top collections data from WAX blockchain
 * to use in the Atomic Assets API Stress Testing Tool
 */

/**
 * Fetches top collections from HiveBP stats API
 * @param {number} limit - Number of collections to fetch (default: 5)
 * @returns {Promise<Array>} - Array of collection names
 */
export async function fetchTopCollections(limit = 5) {
  const apiURL =
    "https://stats.hivebp.io/v2/top-collections/1?limit=30&offset=0";

  console.log(`Fetching top ${limit} collections from HiveBP...`);

  try {
    const response = await fetch(apiURL);

    if (!response.ok) {
      throw new Error(`API returned status ${response.status}`);
    }

    const data = await response.json();

    if (!data || !Array.isArray(data.data)) {
      throw new Error("Invalid API response format");
    }

    // Extract collection names and take the top 'limit' collections
    const collections = data.data
      .slice(0, limit)
      .map((collection) => collection.collection_name);

    console.log(`Successfully fetched collections: ${collections.join(", ")}`);
    return collections;
  } catch (error) {
    console.error(`Error fetching collections: ${error.message}`);
    // Return some default collections in case of failure
    return [
      "farmersworld",
      "alien.worlds",
      "atomicmarket",
      "atomichub",
      "gpk.topps",
    ];
  }
}

/**
 * Fetches collections from multiple sources and returns unique results
 * @param {number} limit - Total number of unique collections to return (default: 5)
 * @returns {Promise<Array>} - Array of collection names
 */
export async function fetchCollections(limit = 5) {
  try {
    // Try the primary source first
    const primaryCollections = await fetchTopCollections(limit);

    if (primaryCollections.length >= limit) {
      return primaryCollections;
    }
    const secondaryCollections = [];

    // Combine results, remove duplicates, and limit to requested number
    const allCollections = [
      ...new Set([...primaryCollections, ...secondaryCollections]),
    ];
    return allCollections.slice(0, limit);
  } catch (error) {
    console.error(`Error fetching collections: ${error.message}`);
    // Return fallback collections if everything fails
    return [
      "farmersworld",
      "alien.worlds",
      "atomicmarket",
      "atomichub",
      "gpk.topps",
    ];
  }
}

// If this file is run directly (not imported), fetch and log collections
if (import.meta.main) {
  try {
    const collections = await fetchCollections(5);
    console.log("Top collections:", collections);
  } catch (error) {
    console.error("Error:", error.message);
  }
}
