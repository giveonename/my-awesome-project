import { View, Text, Image} from '@tarojs/components'
import Taro, { useRouter, useShareAppMessage } from '@tarojs/taro'
import { useState, useEffect } from 'react'
import { api, resolveImageUrl } from '../../utils/api'
import CachedImage from '../../components/CachedImage'
import { ClothingItem } from '../../types'
import { TYPE_LABELS, COLOR_MAP, getTypeLabel, OCCASION_LABELS } from '../../constants'
import './index.scss'
import { icons } from '../../constants/icons'

interface OutfitDetail {
  id: string
  items: ClothingItem[]
  occasion?: string
  reasoning?: string
  highlights?: string[]
  style_notes?: string
  care_note?: string
  model_image_url?: string
  like_count: number
  is_liked_by_me: boolean
  source?: string
  status?: string
  name?: string
}

export default function OutfitDetailPage() {
  const router = useRouter()
  const [outfit, setOutfit] = useState<OutfitDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [wearing, setWearing] = useState(false)

  useEffect(() => {
    const id = router.params.id
    if (id) {
      loadDetail(id)
    }
  }, [router.params.id])

  const loadDetail = async (id: string) => {
    try {
      const data = await api.get<OutfitDetail>(`/outfits/${id}`)
      setOutfit(data)
    } catch (err) {
      console.error('Load outfit detail failed:', err)
      Taro.showToast({ title: '加载出了点问题', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  const handleLike = async () => {
    if (!outfit) return
    try {
      await api.post(`/outfits/${outfit.id}/feedback`, { rating: 5 })
      setOutfit(prev => prev ? {
        ...prev,
        is_liked_by_me: !prev.is_liked_by_me,
        like_count: prev.is_liked_by_me ? prev.like_count - 1 : prev.like_count + 1,
      } : null)
    } catch (err) {
      console.error('Like failed:', err)
    }
  }

  const handleWear = async () => {
    if (!outfit || wearing) return
    setWearing(true)
    try {
      await api.post(`/outfits/${outfit.id}/accept`)
      Taro.showToast({ title: '已记录今日穿搭！', icon: 'success' })
    } catch (err) {
      console.error('Accept outfit failed:', err)
      Taro.showToast({ title: '记录没成功', icon: 'none' })
    } finally {
      setWearing(false)
    }
  }

  const handlePreviewPhoto = () => {
    if (!outfit?.model_image_url) return
    Taro.previewImage({ urls: [resolveImageUrl(outfit.model_image_url) || ''] })
  }

  const handleDelete = async () => {
    if (!outfit) return
    const { confirm } = await Taro.showModal({
      title: '删除搭配',
      content: '确定要删除这个搭配吗？删除后无法恢复。',
      confirmColor: '#ff4d4f',
    })
    if (!confirm) return

    try {
      await api.delete(`/outfits/${outfit.id}`)
      Taro.showToast({ title: '已删除', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 1200)
    } catch (err) {
      console.error('Delete outfit failed:', err)
      Taro.showToast({ title: '删除失败', icon: 'none' })
    }
  }

  const handleEdit = () => {
    if (!outfit) return
    Taro.navigateTo({ url: `/pages/diy/index?outfit_id=${outfit.id}` })
  }

  const handleShare = () => {
    if (!outfit) return
    Taro.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] })
  }

  useShareAppMessage(() => {
    const title = outfit?.name || (outfit?.occasion ? `${OCCASION_LABELS[outfit.occasion] || outfit.occasion}搭配` : '我的搭配')
    return {
      title,
      path: `/pages/outfit-detail/index?id=${outfit?.id}`,
    }
  })

  if (loading) {
    return (
      <View className='od-page'>
        <View className='od-skeleton-hero' />
        <View className='od-skeleton-section'>
          <View className='od-skeleton-line od-skeleton-line--60' />
          <View className='od-skeleton-items'>
            <View className='od-skeleton-item' />
            <View className='od-skeleton-item' />
            <View className='od-skeleton-item' />
          </View>
        </View>
        <View className='od-skeleton-section'>
          <View className='od-skeleton-line od-skeleton-line--40' />
          <View className='od-skeleton-line od-skeleton-line--80' />
          <View className='od-skeleton-line od-skeleton-line--60' />
        </View>
      </View>
    )
  }

  return (
    <View className='od-page'>

      {/* Hero: Outfit Photo */}
      {outfit.model_image_url && (
        <View className='od-hero' onClick={handlePreviewPhoto}>
          <CachedImage
            className='od-hero-img'
            src={resolveImageUrl(outfit.model_image_url) || ''}
            mode='aspectFill'
          />
        </View>
      )}

      {/* Outfit Name & Occasion */}
      <View className='od-header-info'>
        {outfit.name && (
          <Text className='od-outfit-name'>{outfit.name}</Text>
        )}
        {outfit.occasion && (
          <View className='od-occasion-tag'>
            <Text className='od-occasion-tag-text'>{OCCASION_LABELS[outfit.occasion] || outfit.occasion}</Text>
          </View>
        )}
      </View>

      {/* Items Grid */}
      <View className='od-section'>
        <Text className='od-section-title'>搭配单品</Text>
        <View className='od-items-grid'>
          {(outfit.items || []).map((item, idx) => (
            <View
              key={item.id || idx}
              className='od-item'
              onClick={() => Taro.navigateTo({ url: `/pages/item-detail/index?id=${item.id}` })}
            >
              {item.thumbnail_url ? (
                <CachedImage className='od-item-img' src={resolveImageUrl(item.thumbnail_url) || ''} mode='aspectFill' />
              ) : (
                <View className='od-item-placeholder'>
                  <Image src={icons['shirt']} className='od-item-emoji' style={{width: '48rpx', height: '48rpx'}} />
                </View>
              )}
              <View className='od-item-info'>
                <Text className='od-item-type'>{getTypeLabel(item.type)}</Text>
                {item.primary_color && (
                  <View className='od-item-color'>
                    <View className='od-item-color-dot' style={{ backgroundColor: COLOR_MAP[item.primary_color] || '#ccc' }} />
                    <Text className='od-item-color-text'>{item.primary_color}</Text>
                  </View>
                )}
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* AI Reasoning */}
      {outfit.reasoning && (
        <View className='od-section'>
          <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['bot']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='od-section-title'>AI推荐理由</Text></View>
          <View className='od-card'>
            <Text className='od-text'>{outfit.reasoning}</Text>
          </View>
        </View>
      )}

      {/* Highlights */}
      {outfit.highlights && outfit.highlights.length > 0 && (
        <View className='od-section'>
          <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['lightbulb']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='od-section-title'>搭配亮点</Text></View>
          <View className='od-card'>
            {outfit.highlights.map((h, idx) => (
              <View key={idx} className='od-highlight'>
                <Text className='od-highlight-bullet'>•</Text>
                <Text className='od-text'>{h}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Style Notes */}
      {outfit.style_notes && (
        <View className='od-section'>
          <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['sparkles']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='od-section-title'>穿搭小贴士</Text></View>
          <View className='od-card'>
            <Text className='od-text'>{outfit.style_notes}</Text>
          </View>
        </View>
      )}

      {/* Like Count */}
      <View className='od-like-bar'>
        <View className='od-like-btn' onClick={handleLike}>
          <Text className='od-like-icon'>{outfit.is_liked_by_me ? '❤' : '♡'}</Text>
          <Text className='od-like-count'>{outfit.like_count}</Text>
        </View>
      </View>

      {/* Action Buttons */}
      <View className='od-actions'>
        {/* 编辑只对 DIY 搭配有意义；分享/删除对所有搭配开放（AI 搭配也要能删出图库） */}
        <View className='od-action-row'>
          {outfit.source === 'manual' && (
            <View className='od-action-btn od-action-btn--secondary' onClick={handleEdit}>
              <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['edit']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='od-action-btn-text'>编辑</Text></View>
            </View>
          )}
          <View className='od-action-btn od-action-btn--secondary' onClick={handleShare}>
            <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['share']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='od-action-btn-text'>分享</Text></View>
          </View>
          <View className='od-action-btn od-action-btn--danger' onClick={handleDelete}>
            <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['trash']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='od-action-btn-text'>删除</Text></View>
          </View>
        </View>
        <View className={`od-action-btn od-action-btn--primary ${wearing ? 'od-action-btn--disabled' : ''}`} onClick={handleWear}>
          <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['thumbs-up']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='od-action-btn-text'>{wearing ? '记录中...' : '今天穿这套'}</Text></View>
        </View>
      </View>
    </View>
  )
}