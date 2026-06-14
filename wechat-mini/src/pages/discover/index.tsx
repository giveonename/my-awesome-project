import { View, Text, ScrollView, Image } from '@tarojs/components'
import Taro, { useDidShow, useReachBottom } from '@tarojs/taro'
import { useState, useCallback, useRef } from 'react'
import { api, resolveImageUrl } from '../../utils/api'
import { getItemDisplayName } from '../../constants'
import './index.scss'
import { icons } from '../../constants/icons'

// ===== Types =====

interface DiscoverPost {
  id: string
  user: { id: string; display_name: string; avatar_url?: string }
  title: string
  content: string
  images?: string[]
  like_count: number
  is_liked_by_me: boolean
  image_height?: number  // 用于瀑布流分列
}

type TabKey = 'discover' | 'follow'

// ===== Mock Data =====

const MOCK_POSTS: DiscoverPost[] = [
  { id: '1', user: { id: 'u1', display_name: '小鱼穿搭' }, title: '秋冬叠穿指南｜这件大衣真的太百搭了', content: '', images: [], like_count: 328, is_liked_by_me: false },
  { id: '2', user: { id: 'u2', display_name: '阿茶' }, title: '通勤穿搭 | 简约不简单的职场风格', content: '', images: [], like_count: 156, is_liked_by_me: false },
  { id: '3', user: { id: 'u3', display_name: 'Momo' }, title: '周末出游穿搭合集', content: '', images: [], like_count: 89, is_liked_by_me: false },
  { id: '4', user: { id: 'u4', display_name: '穿搭日记' }, title: '这件毛衣的颜色也太温柔了吧', content: '', images: [], like_count: 245, is_liked_by_me: true },
  { id: '5', user: { id: 'u5', display_name: '小确幸' }, title: '约会穿搭｜男朋友都说好看', content: '', images: [], like_count: 412, is_liked_by_me: false },
  { id: '6', user: { id: 'u6', display_name: '极简生活' }, title: '一衣多穿｜白衬衫的5种搭配', content: '', images: [], like_count: 178, is_liked_by_me: false },
  { id: '7', user: { id: 'u7', display_name: '时尚捕手' }, title: '今年最火的配色方案，你试过了吗', content: '', images: [], like_count: 93, is_liked_by_me: false },
  { id: '8', user: { id: 'u8', display_name: '衣橱整理师' }, title: '换季衣橱整理心得分享', content: '', images: [], like_count: 67, is_liked_by_me: false },
]

const MOCK_RECOMMENDATIONS = [
  { id: 'r1', title: '本周热门搭配', subtitle: '1.2万人在看', color: 'linear-gradient(135deg, #E0E7FF, #C7D2FE)' },
  { id: 'r2', title: '春季必入单品', subtitle: '精选推荐', color: 'linear-gradient(135deg, #D4F0E7, #B8E6D0)' },
  { id: 'r3', title: '通勤穿搭灵感', subtitle: '职场必备', color: 'linear-gradient(135deg, #FDE8D0, #FAD4A8)' },
  { id: 'r4', title: '约会穿搭合集', subtitle: '甜蜜风格', color: 'linear-gradient(135deg, #FFE0E6, #FFD0D8)' },
]

// ===== Component =====

export default function DiscoverPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('discover')
  const [posts, setPosts] = useState<DiscoverPost[]>(MOCK_POSTS)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)

  // 瀑布流分列：根据图片高度动态分配
  const columnState = useRef<{ left: DiscoverPost[]; right: DiscoverPost[]; leftH: number; rightH: number }>({
    left: [], right: [], leftH: 0, rightH: 0,
  })

  const distributeToColumns = useCallback((items: DiscoverPost[]) => {
    const left: DiscoverPost[] = []
    const right: DiscoverPost[] = []
    let leftH = 0
    let rightH = 0

    items.forEach(post => {
      // 估算卡片高度：图片(按3:4比例) + 标题 + 底部信息
      const imgH = post.image_height || 400
      const cardH = imgH + 120  // 标题+底部约120rpx

      if (leftH <= rightH) {
        left.push(post)
        leftH += cardH
      } else {
        right.push(post)
        rightH += cardH
      }
    })

    columnState.current = { left, right, leftH, rightH }
    return { left, right }
  }, [])

  const { left, right } = distributeToColumns(posts)

  useDidShow(() => {
    loadPosts(true)
  })

  const loadPosts = async (reset: boolean = false) => {
    if (reset) {
      setLoading(true)
      setPage(1)
    }
    try {
      const p = reset ? 1 : page + 1
      const data = await api.get<{ items: DiscoverPost[] }>('/community/posts', {
        page: String(p),
        page_size: '20',
      })
      const newPosts = data.items || []
      if (reset) {
        setPosts(newPosts.length > 0 ? newPosts : MOCK_POSTS)
      } else {
        setPosts(prev => [...prev, ...newPosts])
      }
      setPage(p)
    } catch {
      if (reset) setPosts(MOCK_POSTS)
    } finally {
      setLoading(false)
    }
  }

  useReachBottom(() => {
    if (!loading) loadPosts(false)
  })

  const handleLike = useCallback((postId: string) => {
    setPosts(prev => prev.map(p => {
      if (p.id === postId) {
        return {
          ...p,
          is_liked_by_me: !p.is_liked_by_me,
          like_count: p.is_liked_by_me ? p.like_count - 1 : p.like_count + 1,
        }
      }
      return p
    }))
    api.post(`/community/posts/${postId}/like`).catch(() => {})
  }, [])

  const handleImageLoad = useCallback((postId: string, height: number) => {
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, image_height: height } : p))
  }, [])

  const renderCard = (post: DiscoverPost, colIndex: number) => (
    <View key={post.id} className={`dc-card dc-card--fade-in`} style={{ animationDelay: `${colIndex * 80}ms` }}>
      {/* 封面图 */}
      <View className='dc-card-img-wrap'>
        {post.images && post.images.length > 0 ? (
          <Image
            className='dc-card-img'
            src={resolveImageUrl(post.images[0]) || ''}
            mode='widthFix'
            onLoad={(e) => handleImageLoad(post.id, e.detail.height)}
          />
        ) : (
          <View className='dc-card-img-placeholder'>
            <Image src={icons['shirt']} className='dc-card-img-placeholder-icon' style={{width: '48rpx', height: '48rpx'}} />
          </View>
        )}
      </View>

      {/* 标题 */}
      <Text className='dc-card-title'>{post.title}</Text>

      {/* 底部：用户信息 + 点赞 */}
      <View className='dc-card-footer'>
        <View className='dc-card-user'>
          <View className='dc-card-avatar'>
            <Text className='dc-card-avatar-text'>{post.user.display_name[0]}</Text>
          </View>
          <Text className='dc-card-username'>{post.user.display_name}</Text>
        </View>
        <View className='dc-card-like' onClick={(e) => { e.stopPropagation(); handleLike(post.id) }}>
          <Text className='dc-card-like-icon'>{post.is_liked_by_me ? '❤' : '♡'}</Text>
          <Text className='dc-card-like-count'>{post.like_count > 999 ? `${(post.like_count / 1000).toFixed(1)}k` : post.like_count}</Text>
        </View>
      </View>
    </View>
  )

  return (
    <View className='dc-page'>
      {/* ===== Top Tabs ===== */}
      <View className='dc-tabs'>
        <View
          className={`dc-tab ${activeTab === 'discover' ? 'dc-tab--active' : ''}`}
          onClick={() => setActiveTab('discover')}
        >
          <Text className='dc-tab-text'>发现</Text>
          {activeTab === 'discover' && <View className='dc-tab-indicator' />}
        </View>
        <View
          className={`dc-tab ${activeTab === 'follow' ? 'dc-tab--active' : ''}`}
          onClick={() => setActiveTab('follow')}
        >
          <Text className='dc-tab-text'>关注</Text>
          {activeTab === 'follow' && <View className='dc-tab-indicator' />}
        </View>
      </View>

      {/* ===== 推荐横卡 ===== */}
      <ScrollView scrollX className='dc-recommend-scroll'>
        <View className='dc-recommend-list'>
          {MOCK_RECOMMENDATIONS.map((rec, idx) => (
            <View key={rec.id} className='dc-recommend-card' style={{ background: rec.color }}>
              <Text className='dc-recommend-title'>{rec.title}</Text>
              <Text className='dc-recommend-subtitle'>{rec.subtitle}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* ===== 瀑布流 ===== */}
      <ScrollView scrollY className='dc-scroll'>
        {/* 骨架屏 */}
        {loading && posts.length === 0 && (
          <View className='dc-waterfall'>
            <View className='dc-col'>
              <View className='dc-skel dc-skel--tall' />
              <View className='dc-skel dc-skel--short' />
            </View>
            <View className='dc-col'>
              <View className='dc-skel dc-skel--short' />
              <View className='dc-skel dc-skel--tall' />
            </View>
          </View>
        )}

        {/* 瀑布流内容 */}
        {posts.length > 0 && (
          <View className='dc-waterfall'>
            <View className='dc-col'>
              {left.map((post, idx) => renderCard(post, idx))}
            </View>
            <View className='dc-col'>
              {right.map((post, idx) => renderCard(post, idx))}
            </View>
          </View>
        )}

        {/* 空状态 */}
        {!loading && posts.length === 0 && (
          <View className='dc-empty'>
            <Image src={icons['search']} className='dc-empty-icon' style={{width: '48rpx', height: '48rpx'}} />
            <Text className='dc-empty-title'>还没有动态</Text>
            <Text className='dc-empty-desc'>来当第一个分享穿搭的人吧</Text>
          </View>
        )}

        <View style={{ height: '260rpx' }} />
      </ScrollView>
    </View>
  )
}
