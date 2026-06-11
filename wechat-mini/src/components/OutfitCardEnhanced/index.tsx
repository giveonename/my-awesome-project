import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useCallback } from 'react'
import CachedImage from '../CachedImage'
import { resolveImageUrl } from '../../utils/api'
import { TYPE_LABELS } from '../../constants'
import './index.scss'

interface OutfitItem {
  id: string
  name?: string
  type: string
  thumbnail_url?: string
}

interface OutfitCardEnhancedProps {
  id: string
  items: OutfitItem[]
  modelImageUrl?: string
  occasion?: string
  reasoning?: string
  likeCount?: number
  isLiked?: boolean
  index?: number
  onLike?: (id: string) => void
  onTryOn?: (itemIds: string[], itemNames: string[]) => void
}

export default function OutfitCardEnhanced({
  id,
  items,
  modelImageUrl,
  occasion,
  reasoning,
  likeCount = 0,
  isLiked = false,
  index = 0,
  onLike,
  onTryOn,
}: OutfitCardEnhancedProps) {
  const [imgLoaded, setImgLoaded] = useState(false)
  const displayItems = items.slice(0, 4)

  const handleCardTap = useCallback(() => {
    Taro.navigateTo({ url: `/pages/outfit-detail/index?id=${id}` })
  }, [id])

  const handleItemTap = useCallback((e: any, itemId: string) => {
    e.stopPropagation()
    Taro.navigateTo({ url: `/pages/item-detail/index?id=${itemId}` })
  }, [])

  const handleLike = useCallback((e: any) => {
    e.stopPropagation()
    onLike?.(id)
  }, [id, onLike])

  const handleTryOn = useCallback((e: any) => {
    e.stopPropagation()
    if (items.length === 0) return
    const ids = items.map(i => i.id)
    const names = items.map(i => i.name || TYPE_LABELS[i.type] || i.type)
    onTryOn?.(ids, names)
  }, [items, onTryOn])

  return (
    <View
      className={`oce ${imgLoaded ? 'oce--loaded' : ''}`}
      style={{ animationDelay: `${index * 60}ms` }}
      onClick={handleCardTap}
    >
      <View className='oce-body'>
        {/* Left: Item list */}
        <View className='oce-left'>
          {displayItems.map((item, idx) => (
            <View
              key={item.id || idx}
              className='oce-left-item'
              onClick={(e) => handleItemTap(e, item.id)}
            >
              <View className='oce-left-thumb'>
                {item.thumbnail_url ? (
                  <CachedImage
                    className='oce-left-thumb-img'
                    src={resolveImageUrl(item.thumbnail_url) || ''}
                    mode='aspectFill'
                  />
                ) : (
                  <View className='oce-left-thumb-placeholder'>
                    <Text className='oce-left-thumb-emoji'>👕</Text>
                  </View>
                )}
              </View>
              <View className='oce-left-info'>
                <Text className='oce-left-name'>{item.name || TYPE_LABELS[item.type] || item.type}</Text>
                <Text className='oce-left-type'>{TYPE_LABELS[item.type] || ''}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Right: Effect image or reasoning */}
        <View className='oce-right'>
          {modelImageUrl ? (
            <CachedImage
              className='oce-right-img'
              src={resolveImageUrl(modelImageUrl) || ''}
              mode='aspectFill'
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgLoaded(true)}
            />
          ) : (
            <View className='oce-right-placeholder'>
              <View className='oce-right-placeholder-bg' />
              <Text className='oce-right-placeholder-icon'>✨</Text>
              <Text className='oce-right-placeholder-text'>
                {reasoning ? reasoning.slice(0, 60) + (reasoning.length > 60 ? '...' : '') : 'AI 搭配方案'}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Footer */}
      <View className='oce-footer'>
        <View className='oce-footer-left'>
          {occasion && (
            <View className='oce-occasion-tag'>
              <Text className='oce-occasion-text'>{occasion}</Text>
            </View>
          )}
          <Text className='oce-items-label'>
            {displayItems.map(i => TYPE_LABELS[i.type] || i.type).join(' + ')}
          </Text>
        </View>
        <View className='oce-footer-right'>
          {onTryOn && items.length > 0 && (
            <View className='oce-tryon-btn' onClick={handleTryOn}>
              <Text className='oce-tryon-btn-text'>✨</Text>
            </View>
          )}
          <View className='oce-like' onClick={handleLike}>
            <Text className='oce-like-icon'>{isLiked ? '❤️' : '🤍'}</Text>
            <Text className='oce-like-count'>{likeCount}</Text>
          </View>
        </View>
      </View>
    </View>
  )
}
