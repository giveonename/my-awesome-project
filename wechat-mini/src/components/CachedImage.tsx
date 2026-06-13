import { Image, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useEffect, useRef } from 'react'

interface CachedImageProps {
  src: string
  mode?: string
  className?: string
  style?: React.CSSProperties
  onError?: () => void
}

// LRU cache for downloaded file paths with a maximum size
const MAX_CACHE_SIZE = 200
const downloadCache = new Map<string, string>()

function setCacheEntry(key: string, value: string) {
  // If key already exists, delete it first so it goes to the end (most recently used)
  if (downloadCache.has(key)) {
    downloadCache.delete(key)
  }
  // Evict oldest entry if cache is full
  if (downloadCache.size >= MAX_CACHE_SIZE) {
    const firstKey = downloadCache.keys().next().value
    if (firstKey !== undefined) {
      downloadCache.delete(firstKey)
    }
  }
  downloadCache.set(key, value)
}

function isLocalPath(url: string): boolean {
  return (
    url.startsWith('http://tmp') ||
    url.startsWith('tmp/') ||
    url.startsWith('wxfile://') ||
    url.startsWith('/tmp/') ||
    url.startsWith('https://tmp') ||
    url.startsWith(Taro.env.USER_DATA_PATH)
  )
}

export default function CachedImage({ src, mode = 'aspectFill', className, style, onError }: CachedImageProps) {
  const [localPath, setLocalPath] = useState<string | null>(
    downloadCache.get(src) || (src && isLocalPath(src) ? src : null)
  )
  const [failed, setFailed] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!src) return

    // Local file paths can be used directly as Image src
    if (isLocalPath(src)) {
      setLocalPath(src)
      setFailed(false)
      return
    }

    // Check cache first
    const cached = downloadCache.get(src)
    if (cached) {
      setLocalPath(cached)
      setFailed(false)
      return
    }

    // Download the image
    Taro.downloadFile({
      url: src,
      success: (res) => {
        if (!mountedRef.current) return
        if (res.statusCode === 200 && res.tempFilePath) {
          setCacheEntry(src, res.tempFilePath)
          setLocalPath(res.tempFilePath)
          setFailed(false)
        } else {
          setFailed(true)
          onError?.()
        }
      },
      fail: () => {
        if (!mountedRef.current) return
        setFailed(true)
        onError?.()
      },
    })
  }, [src])

  if (failed || !src) {
    return (
      <View
        className={className}
        style={{
          ...style,
          backgroundColor: '#f0f0f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      />
    )
  }

  return (
    <Image
      className={className}
      style={style}
      src={localPath || ''}
      mode={mode as any}
    />
  )
}