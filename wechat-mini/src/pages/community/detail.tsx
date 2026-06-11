import { View, Text, ScrollView, Image} from '@tarojs/components'
import Taro, { useRouter, useDidShow } from '@tarojs/taro'
import { useState, useCallback } from 'react'
import {
  getHelpRequestDetail,
  getHelpReplies,
  createHelpReply,
  createHelpRequest,
  HelpRequestItem,
  HelpReplyItem,
} from '../../utils/api'
import CachedImage from '../../components/CachedImage'
import { resolveImageUrl } from '../../utils/api'
import './detail.scss'
import { icons } from '../../constants/icons'

const OCCASION_OPTIONS = [
  { key: 'casual', label: '日常' },
  { key: 'work', label: '通勤' },
  { key: 'date', label: '约会' },
  { key: 'party', label: '派对' },
  { key: 'sport', label: '运动' },
  { key: 'formal', label: '正式' },
  { key: 'travel', label: '旅行' },
]

const BUDGET_OPTIONS = [
  { key: 'low', label: '平价' },
  { key: 'medium', label: '中等' },
  { key: 'high', label: '轻奢' },
  { key: 'unlimited', label: '不限' },
]

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  return `${days}天前`
}

export default function CommunityDetailPage() {
  const router = useRouter()
  const isCreate = router.params.mode === 'create'
  const requestId = router.params.id

  // ===== View Mode State =====
  const [request, setRequest] = useState<HelpRequestItem | null>(null)
  const [replies, setReplies] = useState<HelpReplyItem[]>([])
  const [loading, setLoading] = useState(!isCreate)

  // ===== Create Mode State =====
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [occasion, setOccasion] = useState('')
  const [budget, setBudget] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useDidShow(() => {
    if (!isCreate && requestId) {
      loadDetail()
    }
  })

  const loadDetail = async () => {
    setLoading(true)
    try {
      const [reqData, repliesData] = await Promise.all([
        getHelpRequestDetail(requestId),
        getHelpReplies(requestId),
      ])
      setRequest(reqData)
      setReplies(repliesData || [])
    } catch (err) {
      console.error('Load detail failed:', err)
      Taro.showToast({ title: '加载出了点问题', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = useCallback(async () => {
    if (!title.trim()) {
      Taro.showToast({ title: '写个标题吧', icon: 'none' })
      return
    }
    setSubmitting(true)
    try {
      await createHelpRequest({
        title: title.trim(),
        description: description.trim() || undefined,
        occasion: occasion || undefined,
        budget_range: budget || undefined,
      })
      Taro.showToast({ title: '求助发布成功', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 1200)
    } catch (err) {
      console.error('Create help request failed:', err)
      Taro.showToast({ title: '发布没成功，再试一次？', icon: 'none' })
    } finally {
      setSubmitting(false)
    }
  }, [title, description, occasion, budget])

  const handleReply = useCallback(async () => {
    // Navigate to DIY page for now
    Taro.navigateTo({ url: `/pages/diy/index?help_request_id=${requestId}` })
  }, [requestId])

  // ===== Create Mode =====
  if (isCreate) {
    return (
      <View className='cd-page'>
        <View className='cd-header'>
          <View className='cd-back' onClick={() => Taro.navigateBack()}>
            <Text className='cd-back-icon'>←</Text>
          </View>
          <Text className='cd-header-title'>发起求助</Text>
          <View className='cd-header-placeholder' />
        </View>

        <ScrollView scrollY className='cd-scroll'>
          <View className='cd-form'>
            <View className='cd-form-group'>
              <Text className='cd-form-label'>你想搭配什么？</Text>
              <View className='cd-form-input-wrap'>
                <input
                  className='cd-form-input'
                  placeholder='例如：周末出游穿什么好？'
                  value={title}
                  onInput={(e: any) => setTitle(e.detail.value)}
                  maxlength={200}
                  style='height: 80rpx'
                />
              </View>
            </View>

            <View className='cd-form-group'>
              <Text className='cd-form-label'>补充说明（可选）</Text>
              <View className='cd-form-textarea-wrap'>
                <textarea
                  className='cd-form-textarea'
                  placeholder='描述越详细，大家越能帮到你'
                  value={description}
                  onInput={(e: any) => setDescription(e.detail.value)}
                  maxlength={2000}
                  style='height: 200rpx'
                />
              </View>
            </View>

            <View className='cd-form-group'>
              <Text className='cd-form-label'>场合</Text>
              <View className='cd-chip-row'>
                {OCCASION_OPTIONS.map(opt => (
                  <View
                    key={opt.key}
                    className={`cd-chip ${occasion === opt.key ? 'cd-chip--active' : ''}`}
                    onClick={() => setOccasion(opt.key)}
                  >
                    <Text className='cd-chip-text'>{opt.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View className='cd-form-group'>
              <Text className='cd-form-label'>预算</Text>
              <View className='cd-chip-row'>
                {BUDGET_OPTIONS.map(opt => (
                  <View
                    key={opt.key}
                    className={`cd-chip ${budget === opt.key ? 'cd-chip--active' : ''}`}
                    onClick={() => setBudget(opt.key)}
                  >
                    <Text className='cd-chip-text'>{opt.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          <View style={{ height: '160rpx' }} />
        </ScrollView>

        <View className='cd-bottom-bar'>
          <View
            className={`cd-submit-btn press-scale ${submitting ? 'cd-submit-btn--loading' : ''}`}
            onClick={handleCreate}
          >
            <Text className='cd-submit-btn-text'>{submitting ? '发布中...' : '发布求助'}</Text>
          </View>
        </View>
      </View>
    )
  }

  // ===== Loading =====
  if (loading) {
    return (
      <View className='cd-page'>
        <View className='cd-header'>
          <View className='cd-back' onClick={() => Taro.navigateBack()}>
            <Text className='cd-back-icon'>←</Text>
          </View>
          <Text className='cd-header-title'>求助详情</Text>
          <View className='cd-header-placeholder' />
        </View>
        <View className='cd-loading'>
          <Text className='cd-loading-text'>正在加载...</Text>
        </View>
      </View>
    )
  }

  // ===== Detail Mode =====
  if (!request) {
    return (
      <View className='cd-page'>
        <View className='cd-header'>
          <View className='cd-back' onClick={() => Taro.navigateBack()}>
            <Text className='cd-back-icon'>←</Text>
          </View>
          <Text className='cd-header-title'>求助详情</Text>
          <View className='cd-header-placeholder' />
        </View>
        <View className='cd-empty'>
          <Image src={icons['smile']} className='cd-empty-icon' style={{width: '48rpx', height: '48rpx'}} />
          <Text className='cd-empty-text'>这个求助找不到了</Text>
        </View>
      </View>
    )
  }

  return (
    <View className='cd-page'>
      <View className='cd-header'>
        <View className='cd-back' onClick={() => Taro.navigateBack()}>
          <Text className='cd-back-icon'>←</Text>
        </View>
        <Text className='cd-header-title'>求助详情</Text>
        <View className='cd-header-placeholder' />
      </View>

      <ScrollView scrollY className='cd-scroll'>
        {/* Request Card */}
        <View className='cd-request'>
          <View className='cd-request-user'>
            <View className='cd-request-avatar'>
              <Text className='cd-request-avatar-text'>
                {request.user_name ? request.user_name[0] : '?'}
              </Text>
            </View>
            <View className='cd-request-user-info'>
              <Text className='cd-request-username'>{request.user_name || '匿名用户'}</Text>
              <Text className='cd-request-time'>{timeAgo(request.created_at)}</Text>
            </View>
          </View>

          <Text className='cd-request-title'>{request.title}</Text>
          {request.description && (
            <Text className='cd-request-desc'>{request.description}</Text>
          )}

          {/* Reference Images */}
          {request.reference_image_urls && request.reference_image_urls.length > 0 && (
            <ScrollView scrollX className='cd-request-images'>
              <View className='cd-request-images-list'>
                {request.reference_image_urls.map((url, idx) => (
                  <CachedImage
                    key={idx}
                    className='cd-request-image'
                    src={resolveImageUrl(url) || url}
                    mode='aspectFill'
                  />
                ))}
              </View>
            </ScrollView>
          )}
        </View>

        {/* Replies Section */}
        <View className='cd-replies'>
          <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['message-circle']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='cd-replies-title'>{replies.length} 个回复</Text></View>

          {replies.length === 0 && (
            <View className='cd-replies-empty'>
              <Text className='cd-replies-empty-text'>还没有人回复，来当第一个帮Ta的人吧</Text>
            </View>
          )}

          {replies.map((reply, idx) => (
            <View
              key={reply.id}
              className='cd-reply animate-fade-in-up'
              style={{ animationDelay: `${idx * 60}ms` }}
            >
              <View className='cd-reply-user'>
                <View className='cd-reply-avatar'>
                  <Text className='cd-reply-avatar-text'>
                    {reply.user_name ? reply.user_name[0] : '?'}
                  </Text>
                </View>
                <View className='cd-reply-user-info'>
                  <Text className='cd-reply-username'>{reply.user_name || '匿名用户'}</Text>
                  <Text className='cd-reply-time'>{timeAgo(reply.created_at)}</Text>
                </View>
                {reply.is_accepted && (
                  <View className='cd-reply-accepted'>
                    <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['check']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='cd-reply-accepted-text'>最佳回答</Text></View>
                  </View>
                )}
              </View>

              <Text className='cd-reply-content'>{reply.content}</Text>

              {/* Suggested Items */}
              {reply.suggested_items && reply.suggested_items.length > 0 && (
                <View className='cd-reply-items'>
                  {reply.suggested_items.map((itemId, i) => (
                    <View key={i} className='cd-reply-item'>
                      <Text className='cd-reply-item-text'>推荐单品 {i + 1}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ))}
        </View>

        <View style={{ height: '160rpx' }} />
      </ScrollView>

      {/* Bottom Bar */}
      <View className='cd-bottom-bar'>
        <View className='cd-reply-btn press-scale' onClick={handleReply}>
          <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['hand']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='cd-reply-btn-text'>我要帮Ta搭配</Text></View>
        </View>
      </View>
    </View>
  )
}
