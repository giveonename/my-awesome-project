import { View, Text, Image, ScrollView } from '@tarojs/components'
import Taro, { useDidShow, useReachBottom, usePullDownRefresh } from '@tarojs/taro'
import { useState, useRef, useCallback, useEffect } from 'react'
import { api, resolveImageUrl } from '../../utils/api'
import OutfitCard from '../../components/OutfitCard'
import OutfitCardEnhanced from '../../components/OutfitCardEnhanced'
import ProductCard from '../../components/ProductCard'
import VirtualTryOnModal from '../../components/VirtualTryOnModal'
import CachedImage from '../../components/CachedImage'
import { getLocationAndSave } from '../../utils/location'
import { ClothingItem } from '../../types'
import './index.scss'
import { icons } from '../../constants/icons'

interface OutfitRecommendation {
  id: string
  items: ClothingItem[]
  occasion?: string
  reasoning?: string
  like_count?: number
  is_liked_by_me?: boolean
  model_image_url?: string
}

type SuggestTabKey = 'mine' | 'ai' | 'product'

const SUGGEST_TABS: { key: SuggestTabKey; label: string }[] = [
  { key: 'mine', label: '我的搭配' },
  { key: 'ai', label: 'AI搭配' },
  { key: 'product', label: '搭配灵感' },
]

const SCENE_TAGS = [
  { keyword: '通勤', label: '通勤必备' },
  { keyword: '约会', label: '约会穿搭' },
  { keyword: '休闲', label: '休闲日常' },
  { keyword: '运动', label: '运动风格' },
  { keyword: '宴会', label: '宴会造型' },
]

const MAX_RECOMMENDATIONS = 6

// ===== 我的搭配 Tab 组件 =====

function MineOutfitsTab() {
  const [outfits, setOutfits] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useDidShow(() => {
    loadMine()
  })

  const loadMine = async () => {
    setLoading(true)
    try {
      const data = await api.get<{ items: any[] }>('/outfits', {
        page: '1',
        page_size: '50',
        source: 'manual',
      })
      setOutfits(data.items || [])
    } catch (err) {
      console.error('Load mine outfits failed:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <View className='suggest-body'>
        <View className='suggest-waterfall'>
          <View className='suggest-col'>
            <View className='skel-card skel-card--tall' />
            <View className='skel-card skel-card--short' />
          </View>
          <View className='suggest-col'>
            <View className='skel-card skel-card--medium' />
            <View className='skel-card skel-card--tall' />
          </View>
        </View>
      </View>
    )
  }

  if (outfits.length === 0) {
    return (
      <View className='suggest-empty'>
        <Image src={icons['hand']} className='suggest-empty-icon' style={{width: '48rpx', height: '48rpx'}} />
        <Text className='suggest-empty-title'>还没有自定义搭配</Text>
        <Text className='suggest-empty-desc'>去搭配 DIY 页面自由组合你的衣物吧</Text>
        <View
          className='suggest-empty-btn press-scale'
          onClick={() => Taro.navigateTo({ url: '/pages/diy/index' })}
        >
          <Text className='suggest-empty-btn-text'>去搭配</Text>
        </View>
      </View>
    )
  }

  return (
    <View className='suggest-body'>
      <View className='suggest-waterfall'>
        <View className='suggest-col'>
          {outfits.filter((_, i) => i % 2 === 0).map((outfit, idx) => (
            <OutfitCard
              key={outfit.id}
              id={outfit.id}
              items={outfit.items || []}
              occasion={outfit.occasion}
              likeCount={outfit.like_count}
              index={idx}
            />
          ))}
        </View>
        <View className='suggest-col'>
          {outfits.filter((_, i) => i % 2 === 1).map((outfit, idx) => (
            <OutfitCard
              key={outfit.id}
              id={outfit.id}
              items={outfit.items || []}
              occasion={outfit.occasion}
              likeCount={outfit.like_count}
              index={idx}
            />
          ))}
        </View>
      </View>
    </View>
  )
}

// ===== 搭配灵感 Tab 组件 =====

function InspirationTab({ initialItemId, onItemIdConsumed }: { initialItemId?: string; onItemIdConsumed?: () => void }) {
  const [products, setProducts] = useState<any[]>([])
  const [gaps, setGaps] = useState<any[]>([])
  const [activeGap, setActiveGap] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [totalCount, setTotalCount] = useState(0)
  const [showItemPicker, setShowItemPicker] = useState(false)
  const [wardrobeItems, setWardrobeItems] = useState<any[]>([])
  const [activeCategory, setActiveCategory] = useState('all')
  const [activeItemId, setActiveItemId] = useState('')
  const [activeItemName, setActiveItemName] = useState('')
  const [keywordUsed, setKeywordUsed] = useState('')

  const loadGaps = useCallback(async () => {
    try {
      const data = await api.get<any>('/products/gaps')
      setGaps(data.gaps || [])
      setTotalCount(data.total_items || 0)
    } catch (err) { console.error('Load gaps failed:', err) }
  }, [])

  const loadProducts = useCallback(async (reset: boolean = false, opts?: { gapCat?: string; scene?: string; itemId?: string }) => {
    if (reset) { setLoading(true); setProducts([]); setPage(1) }
    else { if (loadingMore || !hasMore) return; setLoadingMore(true) }
    const currentPage = reset ? 1 : page + 1
    try {
      const params: Record<string, string> = { page: String(currentPage), page_size: '20' }
      const effectiveItemId = opts?.itemId || activeItemId
      if (effectiveItemId) {
        params.item_id = effectiveItemId
      } else {
        if (opts?.gapCat || activeGap) params.gap_category = opts?.gapCat || activeGap
        if (opts?.scene || activeScene) params.scene = opts?.scene || activeScene
      }
      const data = await api.get<any>('/products/recommend', params)
      const newProducts = data.products || []
      if (reset) setProducts(newProducts)
      else setProducts(prev => [...prev, ...newProducts])
      setPage(currentPage)
      setHasMore(data.has_more || false)
      setKeywordUsed(data.keyword_used || '')
    } catch (err) { console.error('Load products failed:', err) }
    finally { setLoading(false); setLoadingMore(false) }
  }, [page, hasMore, loadingMore, activeGap, activeScene, activeItemId])

  const loadWardrobeItems = useCallback(async () => {
    try {
      const data = await api.get<any>('/items', { page: '1', page_size: '100' })
      setWardrobeItems(data.items || [])
    } catch (err) { console.error('Load wardrobe items failed:', err) }
  }, [])

  // Single init effect: load gaps, wardrobe, and products in correct mode
  useEffect(() => {
    loadGaps()
    loadWardrobeItems()
    if (initialItemId) {
      setActiveItemId(initialItemId)
      setActiveGap('')
      setActiveScene('')
      loadProducts(true, { itemId: initialItemId })
      onItemIdConsumed?.()
    } else {
      loadProducts(true)
    }
  }, [initialItemId])
  useReachBottom(() => { loadProducts(false) })

  const handleGapTap = useCallback((gap: any) => {
    const next = activeGap === gap.category ? '' : gap.category
    setActiveGap(next)
    setActiveScene('')
    setActiveItemId('')
    setActiveItemName('')
    loadProducts(true, { gapCat: next })
  }, [activeGap, loadProducts])

  const handleSceneTap = useCallback((tag: (typeof SCENE_TAGS)[number]) => {
    const next = activeScene === tag.keyword ? '' : tag.keyword
    setActiveScene(next)
    setActiveGap('')
    setActiveItemId('')
    setActiveItemName('')
    loadProducts(true, { scene: next })
  }, [activeScene, loadProducts])

  const GAP_ICONS: Record<string, string> = {
    top: icons['shirt'], bottom: icons['shirt'], dress: icons['shirt'],
    shoes: icons['shirt'], outerwear: icons['shirt'], accessories: icons['briefcase'],
  }

  const [activeScene, setActiveScene] = useState('')

  const CAT_FILTER = [
    { key: 'all', label: '\u5168\u90E8' },
    { key: 'top', label: '\u4E0A\u8863' },
    { key: 'bottom', label: '\u4E0B\u88C5' },
    { key: 'dress', label: '\u8FDE\u8863\u88D9' },
    { key: 'shoes', label: '\u978B\u5B50' },
    { key: 'outerwear', label: '\u5916\u5957' },
    { key: 'accessories', label: '\u914D\u9970' },
  ]

  const CAT_MAP: Record<string, string[]> = {
    top: ['shirt', 't-shirt', 'sweater', 'hoodie', 'blazer', 'jacket', 'coat', 'top'],
    bottom: ['pants', 'jeans', 'shorts', 'skirt'],
    dress: ['dress'],
    shoes: ['shoes', 'sneakers', 'boots'],
    outerwear: ['jacket', 'coat', 'blazer'],
    accessories: ['accessories', 'hat', 'bag', 'scarf', 'belt'],
  }

  const filteredWardrobe = activeCategory === 'all'
    ? wardrobeItems
    : wardrobeItems.filter((it: any) => (CAT_MAP[activeCategory] || []).includes(it.type))

  const getRelatedItems = () => {
    if (wardrobeItems.length === 0) return []
    const shuffled = [...wardrobeItems].sort(() => 0.5 - Math.random())
    return shuffled.slice(0, 2)
  }

  return (
    <View className='suggest-body'>
      {gaps.length > 0 && (
        <View className='suggest-gaps'>
          <View className='suggest-gaps-header'>
            <Text className='suggest-gaps-icon'>{'\uD83D\uDCA1'}</Text>
            <Text className='suggest-gaps-title'>{'\u4F60\u7684\u8863\u6A71\u8FD8\u7F3A\u8FD9\u4E9B'}</Text>
          </View>
          <ScrollView scrollX className='suggest-gaps-scroll' enhanced showScrollbar={false}>
            <View className='suggest-gaps-list'>
              {gaps.map((gap) => (
                <View key={gap.category} className={`suggest-gap-chip ${activeGap === gap.category ? 'suggest-gap-chip--active' : ''}`} onClick={() => handleGapTap(gap)}>
                  <Image src={GAP_ICONS[gap.category] || icons['shirt']} className='suggest-gap-chip-icon' style={{width: '32rpx', height: '32rpx'}} />
                  <Text className='suggest-gap-chip-label'>{gap.label}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      )}

      <View className='suggest-wardrobe-toggle' onClick={() => setShowItemPicker(!showItemPicker)}>
        <Text className='suggest-wardrobe-toggle-text'>{`\u5DF2\u4E0A\u4F20 ${totalCount} \u4EF6\u8863\u670D ${showItemPicker ? '\u25B2' : '\u25BC'}`}</Text>
      </View>

      {showItemPicker && (
        <View className='suggest-wardrobe-panel'>
          <ScrollView scrollX className='suggest-wardrobe-cats' enhanced showScrollbar={false}>
            <View className='suggest-wardrobe-cats-list'>
              {CAT_FILTER.map((cat) => (
                <View key={cat.key} className={`suggest-wardrobe-cat ${activeCategory === cat.key ? 'suggest-wardrobe-cat--active' : ''}`} onClick={() => setActiveCategory(cat.key)}>
                  <Text className='suggest-wardrobe-cat-text'>{cat.label}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
          <View className='suggest-wardrobe-items-grid'>
            {filteredWardrobe.slice(0, 30).map((item: any) => (
              <View
                key={item.id}
                className={`suggest-wardrobe-item ${activeItemId === item.id ? 'suggest-wardrobe-item--active' : ''}`}
                onClick={() => {
                  setActiveItemId(item.id)
                  setActiveItemName(item.name || item.type || '\u8863\u7269')
                  setActiveGap('')
                  setActiveScene('')
                  setShowItemPicker(false)
                  loadProducts(true, { itemId: item.id })
                }}
              >
                {item.thumbnail_url ? (
                  <CachedImage className='suggest-wardrobe-item-img' src={resolveImageUrl(item.thumbnail_url) || ''} mode='aspectFill' />
                ) : (
                  <View className='suggest-wardrobe-item-placeholder'><Text>{'\uD83D\uDC55'}</Text></View>
                )}
              </View>
            ))}
          </View>
        </View>
      )}

      {activeItemId && (
        <View className='suggest-active-item-banner'>
          <Text className='suggest-active-item-text'>{'\u2728 \u4E3A\u4F60\u641C\u7D22\uFF1A'}{keywordUsed || '\u57FA\u4E8E\u8863\u7269\u642D\u914D'}</Text>
          <Text className='suggest-active-item-clear' onClick={() => {
            setActiveItemId('')
            setActiveItemName('')
            loadProducts(true)
          }}>{'\u6E05\u9664'}</Text>
        </View>
      )}
      {keywordUsed && !activeItemId && (
        <View className='suggest-keyword-banner'>
          <Text className='suggest-keyword-text'>{'\uD83D\uDD0D \u641C\u7D22\uFF1A'}{keywordUsed}</Text>
        </View>
      )}
      {loading ? (
        <View className='suggest-product-grid'>
          <View className='suggest-product-col'><View className='skel-card skel-card--medium' /><View className='skel-card skel-card--short' /></View>
          <View className='suggest-product-col'><View className='skel-card skel-card--tall' /><View className='skel-card skel-card--medium' /></View>
        </View>
      ) : products.length > 0 ? (
        <View className='suggest-product-grid'>
          <View className='suggest-product-col'>
            {products.filter((_: any, i: number) => i % 2 === 0).map((product: any, idx: number) => (
              <ProductCard key={idx} title={product.title} picUrl={product.pic_url} price={product.price} originalPrice={product.original_price} volume={product.volume} shopTitle={product.shop_title} itemUrl={product.item_url} relatedItems={product.related_items || getRelatedItems()} index={idx} />
            ))}
          </View>
          <View className='suggest-product-col'>
            {products.filter((_: any, i: number) => i % 2 === 1).map((product: any, idx: number) => (
              <ProductCard key={idx} title={product.title} picUrl={product.pic_url} price={product.price} originalPrice={product.original_price} volume={product.volume} shopTitle={product.shop_title} itemUrl={product.item_url} relatedItems={product.related_items || getRelatedItems()} index={idx} />
            ))}
          </View>
        </View>
      ) : (
        <View className='suggest-cold-start'>
          <View className='suggest-cold-start-glow' />
          <View className='suggest-cold-start-icon-wrap'>
            <Image src={icons['sparkles']} className='suggest-cold-start-icon' style={{width: '72rpx', height: '72rpx'}} />
          </View>
          <Text className='suggest-cold-start-title'>
            {totalCount > 0 ? '暂无推荐商品' : '你的 AI 造型师已就位'}
          </Text>
          <Text className='suggest-cold-start-desc'>
            {totalCount > 0
              ? '多添加些衣物，AI 才能更精准地推荐'
              : '上传你的第一件衣服，解锁无限穿搭灵感'}
          </Text>
          {totalCount === 0 && (
            <View className='suggest-cold-start-btn press-scale' onClick={() => Taro.navigateTo({ url: '/pages/parse/index' })}>
              <Image src={icons['camera']} style={{width: '36rpx', height: '36rpx', marginRight: '12rpx'}} />
              <Text className='suggest-cold-start-btn-text'>拍照上传</Text>
            </View>
          )}
        </View>
      )}

      {loadingMore && (
        <View className='suggest-load-more'>
          <View className='suggest-load-more-dot' />
          <View className='suggest-load-more-dot' />
          <View className='suggest-load-more-dot' />
        </View>
      )}
    </View>
  )
}


export default function SuggestPage() {
  const [activeTab, setActiveTab] = useState<SuggestTabKey>('ai')
  const [outfits, setOutfits] = useState<OutfitRecommendation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set())
  const requestIdRef = useRef(0)
  const [incomingItemId, setIncomingItemId] = useState('')

  // --- Virtual Try-On ---
  const [tryOnVisible, setTryOnVisible] = useState(false)
  const [tryOnItemIds, setTryOnItemIds] = useState<string[]>([])
  const [tryOnItemNames, setTryOnItemNames] = useState<string[]>([])

  const handleTryOn = useCallback((itemIds: string[], itemNames: string[]) => {
    setTryOnItemIds(itemIds)
    setTryOnItemNames(itemNames)
    setTryOnVisible(true)
  }, [])

  // POST /outfits/suggest — 每次获取一条推荐
  const fetchOneRecommendation = useCallback(async (occasion: string = 'casual'): Promise<OutfitRecommendation | null> => {
    try {
      const loc = await Promise.race([getLocationAndSave(), new Promise<null>(r => setTimeout(() => r(null), 5000))])
      const body: Record<string, unknown> = { occasion }
      if (loc) {
        body.latitude = loc.latitude
        body.longitude = loc.longitude
      }
      const data = await api.post<OutfitRecommendation>('/outfits/suggest', body, { timeout: 180000 })
      return data
    } catch (err: any) {
      // 衣橱衣物不足是正常业务场景，不需要报错
      if (err?.status === 400) return null
      console.error('Failed to get recommendation:', err)
      return null
    }
  }, [])

  // 首屏加载：批量获取推荐
  const fetchOutfits = useCallback(async (reset: boolean = false) => {
    const requestId = ++requestIdRef.current

    if (reset) {
      setLoading(true)
      setOutfits([])
    } else {
      if (loadingMore) return
      setLoadingMore(true)
    }

    try {
      // 获取第一条
      const first = await fetchOneRecommendation()
      if (requestId !== requestIdRef.current) return

      if (first) {
        if (reset) {
          setOutfits([first])
        } else {
          setOutfits(prev => [...prev, first])
        }
        setLoading(false)

        // 并行获取更多推荐
        const remaining = MAX_RECOMMENDATIONS - (reset ? 1 : outfits.length + 1)
        for (let i = 0; i < remaining; i++) {
          if (requestId !== requestIdRef.current) return
          const next = await fetchOneRecommendation()
          if (requestId !== requestIdRef.current) return
          if (next) {
            setOutfits(prev => {
              if (prev.some(o => o.id === next.id)) return prev
              return [...prev, next]
            })
          }
        }
      } else {
        if (reset) setOutfits([])
      }
    } catch (err) {
      if (requestId === requestIdRef.current) {
        console.error('Failed to load outfits:', err)
        if (reset) {
          Taro.showToast({ title: '推荐没拿到，稍后再试试', icon: 'none' })
        }
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [fetchOneRecommendation, loadingMore, outfits.length])

  // 首屏加载 + 检查从衣物详情跳转过来的 item_id
  useDidShow(() => {
    const storedItemId = Taro.getStorageSync('suggest_item_id')
    if (storedItemId) {
      Taro.removeStorageSync('suggest_item_id')
      setIncomingItemId(storedItemId)
      setActiveTab('product')
    } else if (activeTab === 'ai' && outfits.length === 0) {
      fetchOutfits(true)
    }
  })

  // 触底加载更多
  useReachBottom(() => {
    if (activeTab === 'ai' && !loading && !loadingMore && outfits.length < MAX_RECOMMENDATIONS) {
      fetchOutfits(false)
    }
  })

  // 下拉刷新
  usePullDownRefresh(() => {
    fetchOutfits(true).then(() => {
      Taro.stopPullDownRefresh()
    })
  })

  const handleLike = useCallback((id: string) => {
    setLikedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
    api.post(`/outfits/${id}/feedback`, { rating: 5 }).catch(() => {
      // 回滚乐观更新
      setLikedIds(prev => {
        const next = new Set(prev)
        if (next.has(id)) {
          next.delete(id)
        } else {
          next.add(id)
        }
        return next
      })
    })
  }, [])

  const handleRefreshAll = useCallback(() => {
    fetchOutfits(true)
  }, [fetchOutfits])

  return (
    <View className='suggest-page'>
      {/* Top Tabs */}
      <View className='suggest-tabs'>
        {SUGGEST_TABS.map(tab => (
          <View
            key={tab.key}
            className={`suggest-tab ${activeTab === tab.key ? 'suggest-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <Text className='suggest-tab-text'>{tab.label}</Text>
            {activeTab === tab.key && <View className='suggest-tab-indicator' />}
          </View>
        ))}
      </View>


      {/* AI Chat Entry Banner */}
      <View className='suggest-ai-chat-banner' onClick={() => Taro.navigateTo({ url: '/pages/chat/index' })}>
        <View className='suggest-ai-chat-banner-left'>
          <Image src={icons['bot']} className='suggest-ai-chat-banner-icon' style={{width: '48rpx', height: '48rpx'}} />
          <View className='suggest-ai-chat-banner-text'>
            <Text className='suggest-ai-chat-banner-title'>和 AI 造型师聊聊</Text>
            <Text className='suggest-ai-chat-banner-desc'>描述场景，获取穿搭灵感</Text>
          </View>
        </View>
        <Text className='suggest-ai-chat-banner-arrow'>›</Text>
      </View>

      {/* ===== AI Tab Content ===== */}
      {activeTab === 'ai' && (
        <View className='suggest-body'>
          {/* 骨架屏加载 */}
          {loading && (
            <View className='suggest-waterfall'>
              <View className='suggest-col'>
                <View className='skel-card skel-card--tall' />
                <View className='skel-card skel-card--short' />
                <View className='skel-card skel-card--medium' />
              </View>
              <View className='suggest-col'>
                <View className='skel-card skel-card--medium' />
                <View className='skel-card skel-card--tall' />
                <View className='skel-card skel-card--short' />
              </View>
            </View>


          )}

          {/* 瀑布流列表 */}
          {!loading && outfits.length > 0 && (
            <>
              <View className='suggest-waterfall'>
                <View className='suggest-col'>
                  {outfits.filter((_, i) => i % 2 === 0).map((outfit, idx) => (
                    <OutfitCardEnhanced
                      key={outfit.id}
                      id={outfit.id}
                      items={outfit.items}
                      modelImageUrl={outfit.model_image_url}
                      occasion={outfit.occasion}
                      reasoning={outfit.reasoning}
                      likeCount={outfit.like_count}
                      isLiked={likedIds.has(outfit.id) || outfit.is_liked_by_me}
                      index={idx}
                      onLike={handleLike}
                      onTryOn={handleTryOn}
                    />
                  ))}
                </View>
                <View className='suggest-col'>
                  {outfits.filter((_, i) => i % 2 === 1).map((outfit, idx) => (
                    <OutfitCardEnhanced
                      key={outfit.id}
                      id={outfit.id}
                      items={outfit.items}
                      modelImageUrl={outfit.model_image_url}
                      occasion={outfit.occasion}
                      reasoning={outfit.reasoning}
                      likeCount={outfit.like_count}
                      isLiked={likedIds.has(outfit.id) || outfit.is_liked_by_me}
                      index={idx}
                      onLike={handleLike}
                      onTryOn={handleTryOn}
                    />
                  ))}
                </View>
              </View>

              {/* 刷新按钮 */}
              <View className='suggest-refresh-btn' onClick={handleRefreshAll}>
                <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['refresh-cw']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='suggest-refresh-text'>换一批推荐</Text></View>
              </View>
            </>
          )}

          {/* 加载更多 */}
          {loadingMore && (
            <View className='suggest-load-more'>
              <View className='suggest-load-more-dot' />
              <View className='suggest-load-more-dot' />
              <View className='suggest-load-more-dot' />
            </View>
          )}

          {/* 到底了 */}
          {!loading && outfits.length >= MAX_RECOMMENDATIONS && (
            <View className='suggest-end'>
              <Text className='suggest-end-text'>已经到底了，换一批试试？</Text>
            </View>
          )}

          {/* 空状态 */}
          {!loading && outfits.length === 0 && (
            <View className='suggest-empty'>
              <Image src={icons['sparkles']} className='suggest-empty-icon' style={{width: '48rpx', height: '48rpx'}} />
              <Text className='suggest-empty-title'>还没有搭配推荐</Text>
              <Text className='suggest-empty-desc'>
                衣橱里的衣服越多，AI 越能帮你搭配出好看的方案
              </Text>
              <View
                className='suggest-empty-btn press-scale'
                onClick={() => Taro.switchTab({ url: '/pages/wardrobe/index' })}
              >
                <Text className='suggest-empty-btn-text'>去添加衣物</Text>
              </View>
            </View>
          )}
        </View>
      )}

      {/* ===== 我的搭配 Tab ===== */}
      {activeTab === 'mine' && (
        <MineOutfitsTab />
      )}

      {/* ===== 搭配灵感 Tab ===== */}
      {activeTab === 'product' && (
        <InspirationTab initialItemId={incomingItemId} onItemIdConsumed={() => setIncomingItemId('')} />
      )}

      {/* Bottom Padding for TabBar */}
      <View style={{ height: '260rpx' }} />

      {/* Virtual Try-On Modal */}
      <VirtualTryOnModal
        visible={tryOnVisible}
        garmentItemIds={tryOnItemIds}
        garmentNames={tryOnItemNames}
        onClose={() => setTryOnVisible(false)}
      />

    </View>
  )
}


