import Taro from '@tarojs/taro'
import { api } from './api'

export interface Location {
  latitude: number
  longitude: number
}

// Default fallback: Guiyang (贵阳)
const DEFAULT_LOCATION: Location = {
  latitude: 26.647,
  longitude: 106.6302,
}

let cachedLocation: Location | null = null
let locationSaved = false
let lastSavedLat: number | null = null
let lastSavedLon: number | null = null

// Minimum distance change (in degrees, ~100m) to trigger a location save
const LOCATION_SAVE_THRESHOLD = 0.001

/**
 * Get user location using wx.getLocation.
 * Caches the result for the session.
 * Falls back to default location if unavailable.
 */
export async function getLocation(): Promise<Location> {
  if (cachedLocation) return cachedLocation

  try {
    const res = await Taro.getLocation({ type: 'wgs84' })
    cachedLocation = { latitude: res.latitude, longitude: res.longitude }
    return cachedLocation
  } catch (err) {
    console.warn('Failed to get location, using default:', err)
    return DEFAULT_LOCATION
  }
}

/**
 * Get location AND save it to user profile (for backend APIs that need it).
 * Only saves if location has changed significantly to avoid redundant requests.
 */
export async function getLocationAndSave(): Promise<Location> {
  const loc = await getLocation()

  // Only save if location has changed significantly or hasn't been saved yet
  const shouldSave =
    !locationSaved ||
    lastSavedLat === null ||
    lastSavedLon === null ||
    Math.abs(loc.latitude - lastSavedLat) > LOCATION_SAVE_THRESHOLD ||
    Math.abs(loc.longitude - lastSavedLon) > LOCATION_SAVE_THRESHOLD

  if (shouldSave) {
    try {
      await api.patch('/users/me', {
        location_lat: loc.latitude,
        location_lon: loc.longitude,
      })
      locationSaved = true
      lastSavedLat = loc.latitude
      lastSavedLon = loc.longitude
    } catch (err) {
      console.warn('Failed to save location to profile:', err)
    }
  }

  return loc
}

/**
 * Clear cached location (e.g. when user changes location in settings)
 */
export function clearLocationCache() {
  cachedLocation = null
  locationSaved = false
  lastSavedLat = null
  lastSavedLon = null
}