export interface ClothingItem {
  id: string
  type: string
  subtype?: string
  primary_color?: string
  colors: string[]
  pattern?: string
  material?: string
  style: string[]
  formality?: string
  season: string[]
  fit?: string
  occasion: string[]
  brand?: string
  name?: string
  description?: string
  ai_description?: string
  image_url?: string
  thumbnail_url?: string
  wear_count: number
  last_worn_at?: string
  favorite?: boolean
  needs_wash: boolean
  is_archived: boolean
  created_at: string
  source_scene?: string
  tryon_ready?: boolean
  updated_at: string
}

export interface OutfitRecommendation {
  items: ClothingItem[]
  occasion: string
  weather_description?: string
  temperature?: number
  reasoning?: string
}

export interface Outfit {
  id: string
  name?: string
  items: ClothingItem[]
  occasion?: string
  rating?: number
  notes?: string
  worn_date?: string
  created_at: string
}

export interface WeatherData {
  temperature: number
  feels_like: number
  humidity: number
  precipitation_chance: number
  precipitation_mm: number
  wind_speed: number
  condition: string
  condition_code: number
  is_day: boolean
  uv_index: number
  timestamp: string
}

export interface UserProfile {
  id: string
  email: string
  display_name: string
  avatar_url?: string
  timezone: string
  location_name?: string
  onboarding_completed: boolean
}

