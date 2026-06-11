import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useCallback } from 'react'
import CachedImage from '../CachedImage'
import { resolveImageUrl } from '../../utils/api'
import { ClothingItem } from '../../types'
import { TYPE_LABELS } from '../../constants'
import './index.scss'

interface OutfitCardProps {
  id: string
  items: ClothingItem[]
  modelImageUrl?: string
  occasion?: string
  reasoning?: string
  likeCount?: number
  isLiked?: boolean
  index?: number
  onLike?: (id: string) => void
  onTryOn?: (itemIds: string[], itemNames: string[]) => void
}

export default function OutfitCard({
  id,
  items,
  modelImageUrl,
  occasion,
  likeCount = 0,
  isLiked = false,
  index = 0,
  onLike,
  onTryOn,
}: OutfitCardProps) {
  const [imgLoaded, setImgLoaded] = useState(false)

  const heroImage = modelImageUrl || items[0]?.thumbnail_url
  const displayItems = items.slice(0, 3)

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
      className={`oc ${imgLoaded ? 'oc--loaded' : ''}`}
      style={{ animationDelay: `${index * 60}ms` }}
      onClick={handleCardTap}
    >
      {/* Hero Image */}
      <View className='oc-hero'>
        {heroImage ? (
          <CachedImage
            className='oc-hero-img'
            src={resolveImageUrl(heroImage) || ''}
            mode='aspectFill'
            onError={() => setImgLoaded(true)}
          />
        ) : (
          <View className='oc-hero-placeholder'>
            <Text className='oc-hero-placeholder-icon'>👗</Text>
          </View>
        )}
        {occasion && (
          <View className='oc-occasion-tag'>
            <Text className='oc-occasion-text'>{occasion}</Text>
          </View>
        )}
      </View>

      {/* Item Thumbnails */}
      <View className='oc-items'>
        {displayItems.map((item, idx) => (
          <View
            key={item.id || idx}
            className='oc-item'
            onClick={(e) => handleItemTap(e, item.id)}
          >
            {item.thumbnail_url ? (
              <CachedImage
                className='oc-item-img'
                src={resolveImageUrl(item.thumbnail_url) || ''}
                mode='aspectFill'
              />
            ) : (
              <View className='oc-item-placeholder'>
                <Text className='oc-item-placeholder-icon'>👕</Text>
              </View>
            )}
          </View>
        ))}
      </View>

      {/* Footer */}
      <View className='oc-footer'>
        <Text className='oc-type-label'>
          {displayItems.map(i => TYPE_LABELS[i.type] || i.type).join(' + ')}
        </Text>
        <View className='oc-footer-right'>
          {onTryOn && items.length > 0 && (
            <View className='oc-tryon-btn' onClick={handleTryOn}>
              <Text className='oc-tryon-btn-text'>✨</Text>
            </View>
          )}
          <View className='oc-like' onClick={handleLike}>
            <Text className='oc-like-icon'>{isLiked ? '❤️' : '🤍'}</Text>
            <Text className='oc-like-count'>{likeCount}</Text>
          </View>
        </View>
      </View>
    </View>
  )
}
