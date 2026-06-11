import { View, Text, Image} from '@tarojs/components'
import Taro, { useDidShow, useReachBottom, usePullDownRefresh } from '@tarojs/taro'
import { useState, useRef, useCallback } from 'react'
import {
  getHelpRequests,
  HelpRequestItem,
} from '../../utils/api'
import './index.scss'
import { icons } from '../../constants/icons'

type TabKey = 'latest' | 'mine'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'latest', label: '最新求助' },
  { key: 'mine', label: '我的求助' },
]

const OCCASION_LABELS: Record<string, string> = {
  casual: '日常',
  work: '通勤',
  date: '约会',
  party: '派对',
  sport: '运动',
  formal: '正式',
  travel: '旅行',
}

const BUDGET_LABELS: Record<string, string> = {
  low: '平价',
  medium: '中等',
  high: '轻奢',
  unlimited: '不限',
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`
  return `${Math.floor(days / 30)}个月前`
}

export default function CommunityPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('latest')
  const [requests, setRequests] = useState<HelpRequestItem[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const pageRef = useRef(1)
  const requestIdRef = useRef(0)

  const fetchRequests = useCallback(async (reset: boolean = false) => {
    const rid = ++requestIdRef.current

    if (reset) {
      setLoading(true)
      pageRef.current = 1
      setHasMore(true)
    }

    const page = reset ? 1 : pageRef.current
    const params: Record<string, string> = {
      page: String(page),
      page_size: '10',
    }
    if (activeTab === 'mine') {
      params.mine = '1'
    }

    try {
      const data = await getHelpRequests(params)
      if (rid !== requestIdRef.current) return

      if (reset) {
        setRequests(data.items || [])
      } else {
        setRequests(prev => {
          const ids = new Set(prev.map(r => r.id))
          const unique = (data.items || []).filter(r => !ids.has(r.id))
          return [...prev, ...unique]
        })
      }
      setHasMore(data.has_more ?? false)
      pageRef.current = page + 1
    } catch (err) {
      if (rid === requestIdRef.current) {
        console.error('Load help requests failed:', err)
      }
    } finally {
      if (rid === requestIdRef.current) setLoading(false)
    }
  }, [activeTab])

  useDidShow(() => fetchRequests(true))

  useReachBottom(() => {
    if (hasMore && !loading) fetchRequests(false)
  })

  usePullDownRefresh(() => {
    fetchRequests(true).then(() => Taro.stopPullDownRefresh())
  })

  const handleTabChange = useCallback((key: TabKey) => {
    setActiveTab(key)
    setRequests([])
    setLoading(true)
  }, [])

  // Switch tab triggers re-fetch via useEffect equivalent
  // We use a ref to track previous tab to avoid double-fetch
  const prevTabRef = useRef(activeTab)
  if (prevTabRef.current !== activeTab) {
    prevTabRef.current = activeTab
    // Schedule fetch on next tick
    setTimeout(() => fetchRequests(true), 0)
  }

  return (
    <View className='cm-page'>

      {/* Tabs */}
      <View className='cm-tabs'>
        {TABS.map(tab => (
          <View
            key={tab.key}
            className={`cm-tab ${activeTab === tab.key ? 'cm-tab--active' : ''}`}
            onClick={() => handleTabChange(tab.key)}
          >
            <Text className='cm-tab-text'>{tab.label}</Text>
            {activeTab === tab.key && <View className='cm-tab-indicator' />}
          </View>
        ))}
      </View>

      {/* Content */}
      <View className='cm-body'>
        {/* Skeleton */}
        {loading && (
          <View className='cm-skeleton-list'>
            {[1, 2, 3].map(i => (
              <View key={i} className='cm-skeleton-card'>
                <View className='cm-skeleton-header'>
                  <View className='cm-skeleton-avatar' />
                  <View className='cm-skeleton-lines'>
                    <View className='cm-skeleton-line cm-skeleton-line--name' />
                    <View className='cm-skeleton-line cm-skeleton-line--time' />
                  </View>
                </View>
                <View className='cm-skeleton-line cm-skeleton-line--body' />
                <View className='cm-skeleton-line cm-skeleton-line--body cm-skeleton-line--short' />
              </View>
            ))}
          </View>
        )}

        {/* List */}
        {!loading && requests.length > 0 && (
          <View className='cm-list'>
            {requests.map((req, idx) => (
              <View
                key={req.id}
                className='cm-card animate-fade-in-up'
                style={{ animationDelay: `${idx * 60}ms` }}
                onClick={() => Taro.navigateTo({ url: `/pages/community/detail?id=${req.id}` })}
              >
                {/* User Info */}
                <View className='cm-card-user'>
                  <View className='cm-card-avatar'>
                    <Text className='cm-card-avatar-text'>
                      {req.user_name ? req.user_name[0] : '?'}
                    </Text>
                  </View>
                  <View className='cm-card-user-info'>
                    <Text className='cm-card-username'>{req.user_name || '匿名用户'}</Text>
                    <Text className='cm-card-time'>{timeAgo(req.created_at)}</Text>
                  </View>
                  {/* Tags */}
                  <View className='cm-card-tags'>
                    {req.occasion && (
                      <View className='cm-tag'>
                        <Text className='cm-tag-text'>{OCCASION_LABELS[req.occasion] || req.occasion}</Text>
                      </View>
                    )}
                    {req.budget_range && (
                      <View className='cm-tag cm-tag--budget'>
                        <Text className='cm-tag-text'>{BUDGET_LABELS[req.budget_range] || req.budget_range}</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Title & Description */}
                <Text className='cm-card-title'>{req.title}</Text>
                {req.description && (
                  <Text className='cm-card-desc'>{req.description}</Text>
                )}

                {/* Footer */}
                <View className='cm-card-footer'>
                  <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['message-circle']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='cm-card-replies'>{req.reply_count} 个回复</Text></View>
                  <View className='cm-card-status'>
                    <Text className='cm-card-status-text'>
                      {req.status === 'open' ? '等待帮助' : req.status === 'resolved' ? '已解决' : '进行中'}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Loading More */}
        {!loading && hasMore && requests.length > 0 && (
          <View className='cm-load-more'>
            <View className='cm-load-dot' />
            <View className='cm-load-dot' />
            <View className='cm-load-dot' />
          </View>
        )}

        {/* Empty */}
        {!loading && requests.length === 0 && activeTab === 'latest' && (
          <View className='community-empty'>
            <Image src={icons['shirt']} className='community-empty-icon' style={{width: '48rpx', height: '48rpx'}} />
            <Text className='community-empty-title'>还没有穿搭求助</Text>
            <Text className='community-empty-desc'>发布你的穿搭困惑，让社区帮你出主意</Text>
            <View className='community-empty-btn' onClick={() => Taro.navigateTo({ url: '/pages/community/detail' })}>
              <Text className='community-empty-btn-text'>发布第一条求助</Text>
            </View>
          </View>
        )}

        {!loading && requests.length === 0 && activeTab === 'mine' && (
          <View className='community-empty'>
            <Image src={icons['pencil']} className='community-empty-icon' style={{width: '48rpx', height: '48rpx'}} />
            <Text className='community-empty-title'>你还没发过求助</Text>
            <Text className='community-empty-desc'>不确定穿什么？让社区帮你搭配</Text>
            <View className='community-empty-btn' onClick={() => Taro.navigateTo({ url: '/pages/community/detail' })}>
              <Text className='community-empty-btn-text'>发布求助</Text>
            </View>
          </View>
        )}

        <View style={{ height: '120rpx' }} />
      </View>

      {/* FAB */}
      <View
        className='cm-fab press-scale'
        onClick={() => Taro.navigateTo({ url: '/pages/community/detail?mode=create' })}
      >
        <Text className='cm-fab-icon'>＋</Text>
        <Text className='cm-fab-text'>发起求助</Text>
      </View>
    </View>
  )
}
