import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useCallback } from 'react'
import CachedImage from '../CachedImage'
import { resolveImageUrl } from '../../utils/api'
import './index.scss'

interface ProductCardProps {
  title: string
  picUrl: string
  price: string
  originalPrice?: string
  volume?: string
  shopTitle?: string
  itemUrl?: string
  relatedItems?: { thumbnail_url?: string; name?: string }[]
  reason?: string
  index?: number
}

export default function ProductCard({
  title,
  picUrl,
  price,
  originalPrice,
  volume,
  shopTitle,
  itemUrl,
  relatedItems = [],
  reason,
  index = 0,
}: ProductCardProps) {

  const handleTap = useCallback(() => {
    if (itemUrl) {
      // In mini program, copy link and show toast
      Taro.setClipboardData({
        data: itemUrl,
        success: () => {
          Taro.showToast({ title: '\u94FE\u63A5\u5DF2\u590D\u5236\uFF0C\u53EF\u7528\u6D4F\u89C8\u5668\u6253\u5F00', icon: 'none' })
        },
      })
    }
  }, [itemUrl])

  const formatVolume = (v?: string) => {
    const n = parseInt(v || '0', 10)
    if (n >= 10000) return (n / 10000).toFixed(1) + '\u4E07'
    if (n >= 1000) return (n / 1000).toFixed(1) + '\u5343'
    return String(n)
  }

  const displayRelated = relatedItems.slice(0, 2)

  return (
    <View
      className='pc'
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={handleTap}
    >
      {/* Product image */}
      <View className='pc-img-wrap'>
        <CachedImage
          className='pc-img'
          src={picUrl}
          mode='aspectFill'
        />
      </View>

      {/* Info */}
      <View className='pc-info'>
        <Text className='pc-title'>{title}</Text>
        {/* 可搭配的衣柜衣物（从图片上移到信息区，避免压在商品图上） */}
        {displayRelated.length > 0 && (
          <View className='pc-related'>
            {displayRelated.map((item, idx) => (
              <View key={idx} className='pc-related-item'>
                {item.thumbnail_url ? (
                  <CachedImage
                    className='pc-related-img'
                    src={resolveImageUrl(item.thumbnail_url) || ''}
                    mode='aspectFill'
                  />
                ) : (
                  <View className='pc-related-placeholder'>
                    <Text className='pc-related-emoji'>👕</Text>
                  </View>
                )}
              </View>
            ))}
            <Text className='pc-related-label'>可搭配</Text>
          </View>
        )}
        {reason && (
          <Text className='pc-reason'>{reason}</Text>
        )}
        <View className='pc-price-row'>
          <Text className='pc-price'>¥{price}</Text>
          {originalPrice && parseFloat(originalPrice) > parseFloat(price) && (
            <Text className='pc-original-price'>¥{originalPrice}</Text>
          )}
        </View>
        <View className='pc-meta'>
          {volume && parseInt(volume, 10) > 0 && (
            <Text className='pc-volume'>{formatVolume(volume)}\u9500</Text>
          )}
          {shopTitle && (
            <Text className='pc-shop'>{shopTitle}</Text>
          )}
        </View>
      </View>
    </View>
  )
}
