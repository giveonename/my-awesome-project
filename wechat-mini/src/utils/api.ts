import Taro from '@tarojs/taro'

// API base URL — auto-detected via get-local-ip.cjs, see src/env.ts
import { API_BASE as ENV_API_BASE } from '../env'
export const API_BASE = ENV_API_BASE

let accessToken: string | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
  if (token) {
    Taro.setStorageSync('access_token', token)
  } else {
    Taro.removeStorageSync('access_token')
  }
}

export function getAccessToken(): string | null {
  if (!accessToken) {
    accessToken = Taro.getStorageSync('access_token') || null
  }
  return accessToken
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  data?: any
  params?: Record<string, string>
  timeout?: number
}

export class ApiError extends Error {
  status: number
  data: unknown

  constructor(message: string, status: number, data: unknown) {
    super(message)
    this.status = status
    this.data = data
    this.name = 'ApiError'
  }
}

export async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', data, params } = options

  let url = `${API_BASE}${endpoint}`
  if (params) {
    const searchParams = new URLSearchParams(params)
    url += `?${searchParams.toString()}`
  }

  const header: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const token = getAccessToken()
  if (token) {
    header['Authorization'] = `Bearer ${token}`
  }

  try {
    const response = await Taro.request({
      url,
      method,
      data: data ? JSON.stringify(data) : undefined,
      header,
      timeout: options.timeout || 60000,
    })

    const { statusCode, data: responseData } = response

    if (statusCode >= 200 && statusCode < 300) {
      if (statusCode === 204) return undefined as T
      return responseData as T
    }

    // Handle 401 Unauthorized - redirect to login
    if (statusCode === 401) {
      setAccessToken(null)
      Taro.redirectTo({ url: '/pages/login/index' })
      throw new ApiError('登录已过期，请重新登录', 401, responseData)
    }

    // 优先显示后端返回的具体字段错误
    let message = '请求失败'
    if (responseData?.errors?.length > 0) {
      const first = responseData.errors[0]
      message = first.field ? `${first.field}: ${first.message}` : first.message
    } else if (typeof responseData?.detail === 'string') {
      message = responseData.detail
    } else if (responseData?.detail?.message) {
      message = responseData.detail.message
    } else if (responseData?.error?.message) {
      message = responseData.error.message
    }

    throw new ApiError(message, statusCode, responseData)
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError('网络好像断了，检查一下连接？', 0, null)
  }
}

export async function uploadFile<T = unknown>(
  endpoint: string,
  filePath: string,
  fileName: string = 'image',
  formData?: Record<string, string>,
  timeout?: number
): Promise<T> {
  const url = `${API_BASE}${endpoint}`
  const token = getAccessToken()

  const header: Record<string, string> = {}
  if (token) {
    header['Authorization'] = `Bearer ${token}`
  }

  const formDataObj: Record<string, string> = {}
  if (formData) {
    Object.assign(formDataObj, formData)
  }

  let res: Taro.uploadFile.SuccessCallbackResult
  try {
    res = await Taro.uploadFile({
      url,
      filePath,
      name: fileName,
      formData: Object.keys(formDataObj).length > 0 ? formDataObj : undefined,
      header,
      timeout: timeout || 60000,
    })
  } catch (err: any) {
    const msg = err?.errMsg || '网络不太给力，稍后再试试'
    Taro.showToast({ title: msg, icon: 'none' })
    throw new ApiError(msg, 0, null)
  }

  if (res.statusCode >= 200 && res.statusCode < 300) {
    try {
      return JSON.parse(res.data) as T
    } catch {
      return undefined as T
    }
  }

  // Handle 401 Unauthorized
  if (res.statusCode === 401) {
    setAccessToken(null)
    Taro.redirectTo({ url: '/pages/login/index' })
    throw new ApiError('登录已过期，请重新登录', 401, res.data)
  }

  const message = (() => {
    try {
      const errData = JSON.parse(res.data)
      // 优先显示后端返回的具体字段错误
      if (errData.errors?.length > 0) {
        const first = errData.errors[0]
        return first.field ? `${first.field}: ${first.message}` : first.message
      }
      return (
        (typeof errData.detail === 'string'
          ? errData.detail
          : errData.detail?.message) ||
        errData.error?.message ||
        '请求失败'
      )
    } catch {
      return '请求失败'
    }
  })()

  throw new ApiError(message, res.statusCode, res.data)
}

/**
 * Resolve relative image URLs to absolute URLs.
 * Backend may return relative paths like "/api/v1/images/xxx"
 * which need to be prefixed with the API base URL for the mini program.
 */
export function resolveImageUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined

  // Pass through data URLs and local file paths
  if (url.startsWith('data:')) return url
  if (url.startsWith('wxfile://') || url.startsWith('http://usr') || url.startsWith('usr') || url.includes('/bg_swap_')) return url

  // Force HTTPS — WeChat mini program requires it
  if (url.startsWith('http://')) url = url.replace('http://', 'https://')
  if (url.startsWith('https://')) return url

  // Relative path - prepend API base (remove /api/v1 from API_BASE since url starts with /api)
  const baseUrl = API_BASE.replace('/api/v1', '')
  return `${baseUrl}${url}`
}

export const api = {
  get: <T>(endpoint: string, params?: Record<string, string>, opts?: { timeout?: number }) =>
    request<T>(endpoint, { method: 'GET', params, timeout: opts?.timeout }),

  post: <T>(endpoint: string, data?: unknown, opts?: { timeout?: number }) =>
    request<T>(endpoint, { method: 'POST', data, timeout: opts?.timeout }),

  put: <T>(endpoint: string, data?: unknown, opts?: { timeout?: number }) =>
    request<T>(endpoint, { method: 'PUT', data, timeout: opts?.timeout }),

  patch: <T>(endpoint: string, data?: unknown, opts?: { timeout?: number }) =>
    request<T>(endpoint, { method: 'PATCH', data, timeout: opts?.timeout }),

  delete: <T>(endpoint: string) =>
    request<T>(endpoint, { method: 'DELETE' }),
}

// ===== Body Profile API =====

export interface BodyProfileData {
  height_cm?: number | null
  weight_kg?: number | null
  body_type?: string | null
  shoulder_type?: string | null
  leg_type?: string | null
  upper_lower_ratio?: string | null
  bust_cm?: number | null
  waist_cm?: number | null
  hip_cm?: number | null
  skin_tone?: string | null
  want_to_improve?: string[] | null
  extra?: Record<string, unknown> | null
}

export interface BodyProfileResponse extends BodyProfileData {
  user_id: string
  created_at?: string
  updated_at?: string
}

export function getBodyProfile(): Promise<BodyProfileResponse> {
  return request<BodyProfileResponse>('/users/me/body-profile')
}

export function updateBodyProfile(data: BodyProfileData): Promise<BodyProfileResponse> {
  return request<BodyProfileResponse>('/users/me/body-profile', { method: 'PUT', data })
}

// ===== Community API =====

export interface HelpRequestData {
  title: string
  description?: string
  occasion?: string
  budget_range?: string
  style_preference?: string
  reference_image_urls?: string[]
}

export interface HelpRequestItem {
  id: string
  user_id: string
  title: string
  description?: string
  occasion?: string
  budget_range?: string
  style_preference?: string
  reference_image_urls?: string[]
  status: string
  reply_count: number
  created_at: string
  updated_at: string
  user_name?: string
  user_avatar?: string
}

export interface HelpRequestListResponse {
  items: HelpRequestItem[]
  total: number
  page: number
  page_size: number
  has_more: boolean
}

export interface HelpReplyData {
  content: string
  suggested_items?: string[]
  image_urls?: string[]
}

export interface HelpReplyItem {
  id: string
  request_id: string
  user_id: string
  content: string
  suggested_items?: string[]
  image_urls?: string[]
  is_accepted: boolean
  created_at: string
  user_name?: string
  user_avatar?: string
}

export function getHelpRequests(params?: Record<string, string>): Promise<HelpRequestListResponse> {
  return request<HelpRequestListResponse>('/community/help-requests', { params })
}

export function createHelpRequest(data: HelpRequestData): Promise<HelpRequestItem> {
  return request<HelpRequestItem>('/community/help-requests', { method: 'POST', data })
}

export function getHelpRequestDetail(id: string): Promise<HelpRequestItem> {
  return request<HelpRequestItem>(`/community/help-requests/${id}`)
}

export function getHelpReplies(requestId: string): Promise<HelpReplyItem[]> {
  return request<HelpReplyItem[]>(`/community/help-requests/${requestId}/replies`)
}

export function createHelpReply(requestId: string, data: HelpReplyData): Promise<HelpReplyItem> {
  return request<HelpReplyItem>(`/community/help-requests/${requestId}/replies`, { method: 'POST', data })
}

// ===== Complete Outfit API =====

export interface CompleteOutfitGroup {
  category: string
  label: string
  reason: string
  products: {
    title: string
    pic_url: string
    price: string
    original_price: string
    volume: string
    shop_title: string
    item_url: string
    category_name: string
    related_items: { thumbnail_url?: string; name?: string }[]
  }[]
}

export interface CompleteOutfitResponse {
  groups: CompleteOutfitGroup[]
  selected_items: { id: string; name: string; thumbnail_url?: string; category: string }[]
  keyword_used: string
}

export function completeOutfit(itemIds: string[], targetCategory?: string): Promise<CompleteOutfitResponse> {
  return request<CompleteOutfitResponse>('/products/complete-outfit', {
    method: 'POST',
    data: { item_ids: itemIds, target_category: targetCategory || '' },
  })
}

// ===== Virtual Try-On API =====

export interface TryOnRequest {
  garment_item_ids: string[]
  model_image_url?: string
  use_plus?: boolean
  use_refiner?: boolean
}

export interface TryOnDirectResponse {
  success: boolean
  image_url?: string
  task_id?: string
  model_used?: string
  error?: string
  elapsed_seconds?: number
}

export interface TryOnSubmitResponse {
  task_id: string
  status: string
  model_used: string
  message: string
}

export interface TryOnStatusResponse {
  task_id: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  image_url?: string
  model_used?: string
  error?: string
  elapsed_seconds?: number
}

/** Synchronous try-on — waits for result (30-60s for aitryon-plus) */
export function virtualTryOn(data: TryOnRequest): Promise<TryOnDirectResponse> {
  return request<TryOnDirectResponse>('/virtual-tryon', { method: 'POST', data })
}

/** Submit async try-on task — returns task_id immediately */
export function submitTryOn(data: TryOnRequest): Promise<TryOnSubmitResponse> {
  return request<TryOnSubmitResponse>('/virtual-tryon/submit', { method: 'POST', data })
}

/** Poll try-on task status */
export function getTryOnStatus(taskId: string): Promise<TryOnStatusResponse> {
  return request<TryOnStatusResponse>(`/virtual-tryon/status/${taskId}`)
}

/** Upload full body photo for virtual try-on */
export interface BodyPhotoResponse {
  photo_url: string
  message: string
}


/** List available background templates */
export interface BackgroundItem {
  id: string
  name: string
  filename: string
  available: boolean
}

export function getBackgrounds(): Promise<BackgroundItem[]> {
  return request<BackgroundItem[]>('/virtual-tryon/backgrounds')
}

/** Swap background of a try-on result image — returns image blob URL */
export async function swapBackground(imageUrl: string, backgroundId: string): Promise<string> {
  const token = getAccessToken()
  const resp = await new Promise<Taro.request.SuccessCallbackResult>((resolve, reject) => {
    Taro.request({
      url: `${API_BASE}/virtual-tryon/swap-background`,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      data: { image_url: imageUrl, background_id: backgroundId },
      responseType: 'arraybuffer',
      success: resolve,
      fail: reject,
    })
  })
  // Save to temp file and return path
  const arrayBuffer = resp.data as ArrayBuffer
  const fs = Taro.getFileSystemManager()
  const filePath = `${Taro.env.USER_DATA_PATH}/bg_swap_${Date.now()}.jpg`
  // Write synchronously in a Promise wrapper
  await new Promise<void>((resolve, reject) => {
    fs.writeFile({
      filePath,
      data: arrayBuffer,
      encoding: 'binary',
      success: () => resolve(),
      fail: (err) => reject(err),
    })
  })
  return filePath
}
export function uploadBodyPhoto(filePath: string): Promise<BodyPhotoResponse> {
  return uploadFile<BodyPhotoResponse>('/virtual-tryon/body-photo', filePath, 'image', {}, 60000)
}

export function getBodyPhoto(): Promise<BodyPhotoResponse | null> {
  return request<BodyPhotoResponse | null>('/virtual-tryon/body-photo')
}




