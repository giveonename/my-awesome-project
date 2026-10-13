import { View, Text, Image, ScrollView } from '@tarojs/components'
import Taro, { useDidShow, useReachBottom, usePullDownRefresh } from '@tarojs/taro'
import { useState, useRef, useCallback, useEffect } from 'react'
import { api, resolveImageUrl, completeOutfit, CompleteOutfitGroup, uploadFile } from '../../utils/api'
import OutfitCardEnhanced from '../../components/OutfitCardEnhanced'
import ProductCard from '../../components/ProductCard'
import VirtualTryOnModal from '../../components/VirtualTryOnModal'
import CachedImage from '../../components/CachedImage'
import { getLocationAndSave } from '../../utils/location'
import { ClothingItem } from '../../types'
import { OCCASION_FILTERS, OCCASION_OPTIONS, OCCASION_LABELS } from '../../constants'
import './index.scss'
import { icons } from '../../constants/icons'

interface OutfitRecommendation {
  id: string
  items: ClothingItem[]
  occasion?: string
  reasoning?: string
  highlights?: string[]
  like_count?: number
  is_liked_by_me?: boolean
  model_image_url?: string
}

interface MineOutfit {
  id: string
  name?: string
  occasion?: string
  source?: string
  model_image_url?: string
  items: ClothingItem[]
  like_count?: number
  is_liked_by_me?: boolean
  created_at?: string
  updated_at?: string
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

// ===== 我的搭配 Tab 组件 =====

function MineOutfitsTab() {
  const [outfits, setOutfits] = useState<MineOutfit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [activeOccasion, setActiveOccasion] = useState('all')
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null)
  const [pendingOccasion, setPendingOccasion] = useState<string | null>(null)
  const [uploadingOutfitId, setUploadingOutfitId] = useState<string | null>(null)

  // 每次显示时刷新数据（从 DIY 返回后也能看到新搭配）
  useDidShow(() => {
    setOutfits([])
    setPage(1)
    setHasMore(true)
    loadMine(1)
  })

  // 关键：子组件的 useDidShow 只在"组件已挂载"之后的页面显示事件里触发。
  // 用户通常是先打开页面、再切到本标签，此时组件刚挂载 → 这次显示事件收不到 →
  // loading 卡在初始值（白屏）。挂载时自己加载一次即可。
  useEffect(() => {
    loadMine(1)
  }, [])

  useReachBottom(() => {
    if (hasMore && !loading && !loadingMore) {
      loadMore()
    }
  })

  const loadMine = async (p: number) => {
    if (p === 1) setLoading(true)
    setError(false)
    try {
      const data = await api.get<{ outfits: MineOutfit[]; total: number; has_more: boolean }>('/outfits', {
        page: String(p),
        page_size: '20',
        source: 'manual',
      })
      if (p === 1) {
        setOutfits(data.outfits || [])
      } else {
        setOutfits(prev => [...prev, ...(data.outfits || [])])
      }
      setHasMore(data.has_more ?? false)
      setPage(p)
    } catch (err) {
      console.error('Load mine outfits failed:', err)
      if (p === 1) setError(true)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  const loadMore = async () => {
    setLoadingMore(true)
    await loadMine(page + 1)
  }

  const handleSetScene = async (outfitId: string, occasion: string) => {
    const prevOccasion = outfits.find(o => o.id === outfitId)?.occasion
    setOutfits(prev => prev.map(o => o.id === outfitId ? { ...o, occasion } : o))
    setEditingSceneId(null)
    setPendingOccasion(null)
    try {
      await api.patch(`/outfits/${outfitId}`, { occasion })
      Taro.showToast({ title: '场景已更新', icon: 'success' })
    } catch (err) {
      console.error('Set scene failed:', err)
      setOutfits(prev => prev.map(o => o.id === outfitId ? { ...o, occasion: prevOccasion } : o))
      Taro.showToast({ title: '设置失败', icon: 'none' })
    }
  }

  const handleUploadPhoto = async (outfitId: string) => {
    try {
      const res = await Taro.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      })

      if (res.tempFilePaths.length === 0) return

      const filePath = res.tempFilePaths[0]

      // 文件大小校验（最大 10MB）
      try {
        const fileInfo = await Taro.getFileInfo({ filePath })
        if (fileInfo.size > 10 * 1024 * 1024) {
          Taro.showToast({ title: '图片太大了，选张小一点的吧', icon: 'none' })
          return
        }
      } catch {
        // getFileInfo 失败不阻塞上传
      }

      setUploadingOutfitId(outfitId)
      Taro.showLoading({ title: '上传中...' })

      const uploadResult = await uploadFile<{ url: string }>(
        '/items/upload-image',
        filePath,
        'image',
        undefined,
        60000
      )

      await api.patch(`/outfits/${outfitId}`, { outfit_photo_url: uploadResult.url })

      setOutfits(prev => prev.map(o =>
        o.id === outfitId ? { ...o, model_image_url: uploadResult.url } : o
      ))

      Taro.hideLoading()
      Taro.showToast({ title: '穿搭照已上传', icon: 'success' })
    } catch (err) {
      Taro.hideLoading()
      console.error('Upload photo failed:', err)
      if (err && (err as any).errMsg && (err as any).errMsg.includes('cancel')) {
        return
      }
      Taro.showToast({ title: '上传失败', icon: 'none' })
    } finally {
      setUploadingOutfitId(null)
    }
  }

  const filteredOutfits = activeOccasion === 'all'
    ? outfits
    : outfits.filter(o => o.occasion === activeOccasion)

  if (loading) {
    return (
      <View className='suggest-body'>
        <View className='mine-list'>
          <View className='mine-card-skeleton' />
          <View className='mine-card-skeleton' />
        </View>
      </View>
    )
  }

  if (error) {
    return (
      <View className='suggest-empty'>
        <Text className='suggest-empty-title'>加载失败了</Text>
        <Text className='suggest-empty-desc'>检查一下网络，再试试？</Text>
        <View className='suggest-empty-btn press-scale' onClick={loadMine}>
          <Text className='suggest-empty-btn-text'>重新加载</Text>
        </View>
      </View>
    )
  }

  if (outfits.length === 0) {
    return (
      <View className='suggest-empty'>
        <View className='suggest-empty-glow' />
        <View className='suggest-empty-icon-wrap'>
          <Image src={icons['hand']} className='suggest-empty-icon' style={{width: '64rpx', height: '64rpx'}} />
        </View>
        <Text className='suggest-empty-title'>还没有自定义搭配</Text>
        <Text className='suggest-empty-desc'>去搭配 DIY 页面自由组合你的衣物吧</Text>
        <View
          className='suggest-empty-btn'
          onClick={() => Taro.navigateTo({ url: '/pages/diy/index' })}
        >
          <Text className='suggest-empty-btn-text'>去搭配</Text>
        </View>
      </View>
    )
  }

  const handlePhotoClick = (outfit: any) => {
    if (outfit.model_image_url) {
      Taro.previewImage({ urls: [resolveImageUrl(outfit.model_image_url) || ''] })
    } else {
      handleUploadPhoto(outfit.id)
    }
  }

  return (
    <View className='mine-container'>
      {/* 场景筛选栏 */}
      <ScrollView className='mine-occasion-bar' scrollX enableFlex>
        {OCCASION_FILTERS.map(o => (
          <View
            key={o.key}
            className={`mine-occasion-tag ${activeOccasion === o.key ? 'mine-occasion-tag--active' : ''}`}
            onClick={() => setActiveOccasion(o.key)}
          >
            <Text className='mine-occasion-tag-text'>{o.label}</Text>
          </View>
        ))}
      </ScrollView>

      {/* 搭配列表 */}
      {filteredOutfits.length === 0 ? (
        <View className='mine-filtered-empty'>
          <Text className='mine-filtered-empty-text'>该场景暂无搭配</Text>
          <Text className='mine-filtered-empty-hint'>换个场景试试，或创建新搭配</Text>
        </View>
      ) : (
      <View className='mine-list'>
        {filteredOutfits.map((outfit) => (
          <View key={outfit.id} className='mine-card'>
            {/* 左侧衣物缩略图 - 点击进入详情 */}
            <View
              className='mine-card-left'
              onClick={() => Taro.navigateTo({ url: `/pages/outfit-detail/index?id=${outfit.id}` })}
            >
              <View className='mine-card-items'>
                {(outfit.items || []).slice(0, 2).map((item: any, i: number) => (
                  <View key={item.id || i} className='mine-card-item'>
                    {item.thumbnail_url ? (
                      <CachedImage
                        className='mine-card-item-img'
                        src={resolveImageUrl(item.thumbnail_url) || ''}
                        mode='aspectFill'
                      />
                    ) : (
                      <View className='mine-card-item-placeholder'>
                        <Text className='mine-card-item-emoji'>👕</Text>
                      </View>
                    )}
                  </View>
                ))}
                {(outfit.items || []).length > 2 && (
                  <View className='mine-card-item-more'>
                    <Text className='mine-card-item-more-text'>+{outfit.items.length - 2}</Text>
                  </View>
                )}
              </View>
              {/* 搭配名称和时间 */}
              {outfit.name && (
                <Text className='mine-card-name'>{outfit.name}</Text>
              )}
              {outfit.created_at && (
                <Text className='mine-card-time'>
                  {new Date(outfit.created_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                </Text>
              )}
              {/* 设定场景标签 */}
              <View
                className={`mine-card-scene ${editingSceneId === outfit.id ? 'mine-card-scene--editing' : ''} ${outfit.occasion ? 'mine-card-scene--set' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setEditingSceneId(editingSceneId === outfit.id ? null : outfit.id)
                  setPendingOccasion(null)
                }}
              >
                <Text className='mine-card-scene-text'>
                  {outfit.occasion ? OCCASION_LABELS[outfit.occasion] || outfit.occasion : '设定场景'}
                </Text>
              </View>
            </View>

            {/* 右侧穿搭照区域 - 有照片点击预览，无照片点击上传 */}
            <View
              className='mine-card-right'
              onClick={(e) => {
                e.stopPropagation()
                handlePhotoClick(outfit)
              }}
            >
              {outfit.model_image_url ? (
                <>
                  <CachedImage
                    className='mine-card-photo-img'
                    src={resolveImageUrl(outfit.model_image_url) || ''}
                    mode='aspectFill'
                  />
                  <View className='mine-card-photo-replace' onClick={(e) => {
                    e.stopPropagation()
                    handleUploadPhoto(outfit.id)
                  }}>
                    <Text className='mine-card-photo-replace-text'>更换</Text>
                  </View>
                </>
              ) : (
                <View className='mine-card-photo'>
                  <Text className='mine-card-photo-icon'>📷</Text>
                  <Text className='mine-card-photo-text'>点击上传穿搭照</Text>
                  <Text className='mine-card-photo-hint'>记录你的穿搭</Text>
                </View>
              )}
            </View>

            {/* 场景选择面板 */}
            {editingSceneId === outfit.id && (
              <View className='mine-scene-overlay' onClick={() => { setEditingSceneId(null); setPendingOccasion(null) }}>
                <View className='mine-scene-panel' onClick={(e) => e.stopPropagation()}>
                  <View className='mine-scene-grid'>
                    {OCCASION_OPTIONS.map(o => (
                      <View
                        key={o.key}
                        className={`mine-scene-item ${(pendingOccasion || outfit.occasion) === o.key ? 'mine-scene-item--active' : ''}`}
                        onClick={() => setPendingOccasion(o.key)}
                      >
                        <Text className='mine-scene-item-text'>{o.label}</Text>
                      </View>
                    ))}
                  </View>
                  <View className='mine-scene-actions'>
                    <View className='mine-scene-btn mine-scene-btn--cancel' onClick={() => { setEditingSceneId(null); setPendingOccasion(null) }}>
                      <Text className='mine-scene-btn-text'>取消</Text>
                    </View>
                    <View className='mine-scene-btn mine-scene-btn--confirm' onClick={() => {
                      if (pendingOccasion) handleSetScene(outfit.id, pendingOccasion)
                      else setEditingSceneId(null)
                    }}>
                      <Text className='mine-scene-btn-text'>确定</Text>
                    </View>
                  </View>
                </View>
              </View>
            )}
          </View>
        ))}
      </View>
      )}

      {/* 加载更多 */}
      {loadingMore && (
        <View className='mine-loading-more'>
          <View className='mine-loading-dot' />
          <View className='mine-loading-dot' />
          <View className='mine-loading-dot' />
        </View>
      )}
      {!hasMore && outfits.length > 0 && (
        <View className='mine-no-more'>
          <Text className='mine-no-more-text'>没有更多了</Text>
        </View>
      )}

      {/* FAB按钮 */}
      <View className='mine-fab' onClick={() => Taro.navigateTo({ url: '/pages/diy/index' })}>
        <Text className='mine-fab-text'>+</Text>
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
  const [showItemPicker, setShowItemPicker] = useState(false)
  const [wardrobeItems, setWardrobeItems] = useState<any[]>([])
  const [activeCategory, setActiveCategory] = useState('all')
  const [activeItemId, setActiveItemId] = useState('')
  const [activeItemName, setActiveItemName] = useState('')
  const [reasonText, setReasonText] = useState('')

  // 补全搭配模式
  const [outfitMode, setOutfitMode] = useState(false)
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [outfitGroups, setOutfitGroups] = useState<CompleteOutfitGroup[]>([])
  const [outfitLoading, setOutfitLoading] = useState(false)

  // 搜索输入
  const [searchInput, setSearchInput] = useState('')

  // 补全搭配分类筛选
  const [outfitCatFilter, setOutfitCatFilter] = useState('all')

  const loadGaps = useCallback(async () => {
    try {
      const data = await api.get<any>('/products/gaps')
      setGaps(data.gaps || [])
    } catch (err) { console.error('Load gaps failed:', err) }
  }, [])

  const loadProducts = useCallback(async (reset: boolean = false, opts?: { gapCat?: string; scene?: string; itemId?: string; keyword?: string }) => {
    if (reset) { setLoading(true); setProducts([]); setPage(1) }
    else { if (loadingMore || !hasMore) return; setLoadingMore(true) }
    const currentPage = reset ? 1 : page + 1
    try {
      const params: Record<string, string> = { page: String(currentPage), page_size: '20' }
      const effectiveItemId = opts?.itemId || activeItemId
      if (opts?.keyword) {
        params.keyword = opts.keyword
      } else if (effectiveItemId) {
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
      if (reset) setReasonText(data.reason || '')
    } catch (err) {
      console.error('Load products failed:', err)
      if (reset) Taro.showToast({ title: '加载失败，请重试', icon: 'none' })
    }
    finally { setLoading(false); setLoadingMore(false) }
  }, [page, hasMore, loadingMore, activeGap, activeScene, activeItemId])

  const loadWardrobeItems = useCallback(async () => {
    try {
      const data = await api.get<any>('/items', { page: '1', page_size: '100' })
      setWardrobeItems(data.items || [])
    } catch (err) { console.error('Load wardrobe items failed:', err) }
  }, [])

  const handleToggleOutfitMode = useCallback(() => {
    if (outfitMode) {
      setOutfitMode(false)
      setSelectedItemIds([])
      setOutfitGroups([])
    } else {
      setOutfitMode(true)
      setProducts([])
      setOutfitGroups([])
      setSelectedItemIds([])
    }
  }, [outfitMode])

  const handleToggleItem = useCallback((itemId: string) => {
    setSelectedItemIds(prev => {
      if (prev.includes(itemId)) return prev.filter(id => id !== itemId)
      if (prev.length >= 3) return prev // 最多选 3 件
      return [...prev, itemId]
    })
  }, [])

  const handleCompleteOutfit = useCallback(async () => {
    if (selectedItemIds.length === 0) return
    setOutfitLoading(true)
    try {
      const data = await completeOutfit(selectedItemIds)
      setOutfitGroups(data.groups || [])
    } catch (err) {
      console.error('Complete outfit failed:', err)
      Taro.showToast({ title: '补全搭配失败，请重试', icon: 'none' })
    } finally {
      setOutfitLoading(false)
    }
  }, [selectedItemIds])

  const handleSearch = useCallback(() => {
    const kw = searchInput.trim()
    if (!kw) return
    setActiveGap('')
    setActiveScene('')
    setActiveItemId('')
    setActiveItemName('')
    setOutfitMode(false)
    setSelectedItemIds([])
    setOutfitGroups([])
    loadProducts(true, { keyword: kw })
  }, [searchInput, loadProducts])

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
    shoes: icons['footprints'] || icons['shirt'], outerwear: icons['shirt'],
    accessories: icons['gem'] || icons['briefcase'],
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

  // 卡片短理由：说清"为什么给你看这件"
  const cardReason = activeGap
    ? `补缺 · ${gaps.find((g: any) => g.category === activeGap)?.label || ''}`
    : activeItemId
      ? `搭「${activeItemName || '衣物'}」`
      : activeScene
        ? '场景推荐'
        : '为你挑'

  const getRelatedItems = () => {
    return []
  }

  return (
    <View className='suggest-body'>
      {/* 场景标签 + 补全搭配入口 */}
      <View className='suggest-scene-tags'>
        <ScrollView scrollX className='suggest-scene-scroll' enhanced showScrollbar={false}>
          <View className='suggest-scene-list'>
            <View
              className={`suggest-scene-chip ${outfitMode ? 'suggest-scene-chip--active' : ''}`}
              onClick={handleToggleOutfitMode}
            >
              <Text className='suggest-scene-chip-text'>{outfitMode ? '退出补全' : '补全搭配'}</Text>
            </View>
            {!outfitMode && SCENE_TAGS.map((tag) => (
              <View
                key={tag.keyword}
                className={`suggest-scene-chip ${activeScene === tag.keyword ? 'suggest-scene-chip--active' : ''}`}
                onClick={() => handleSceneTap(tag)}
              >
                <Text className='suggest-scene-chip-text'>{tag.label}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* 搜索输入框 */}
      {!outfitMode && (
        <View className='suggest-search-bar'>
          <View className='suggest-search-input-wrap'>
            <input
              className='suggest-search-input'
              type='text'
              placeholder='搜索搭配单品，如"约会连衣裙"'
              value={searchInput}
              onInput={(e) => setSearchInput(e.detail.value)}
              onConfirm={handleSearch}
              confirmType='search'
            />
          </View>
          {searchInput.trim() && (
            <View className='suggest-search-btn' onClick={handleSearch}>
              <Text className='suggest-search-btn-text'>搜索</Text>
            </View>
          )}
        </View>
      )}

      {/* 补全搭配模式：多选衣物 */}
      {outfitMode && (
        <View className='suggest-outfit-builder'>
          <Text className='suggest-outfit-builder-hint'>选择 1-3 件衣物，AI 帮你找搭配</Text>
          <ScrollView scrollX className='suggest-wardrobe-cats' enhanced showScrollbar={false}>
            <View className='suggest-wardrobe-cats-list'>
              {CAT_FILTER.map((cat) => (
                <View key={cat.key} className={`suggest-wardrobe-cat ${outfitCatFilter === cat.key ? 'suggest-wardrobe-cat--active' : ''}`} onClick={() => setOutfitCatFilter(cat.key)}>
                  <Text className='suggest-wardrobe-cat-text'>{cat.label}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
          <View className='suggest-outfit-items-grid'>
            {(outfitCatFilter === 'all'
              ? wardrobeItems
              : wardrobeItems.filter((it: any) => (CAT_MAP[outfitCatFilter] || []).includes(it.type))
            ).slice(0, 30).map((item: any) => (
              <View
                key={item.id}
                className={`suggest-outfit-item ${selectedItemIds.includes(item.id) ? 'suggest-outfit-item--selected' : ''}`}
                onClick={() => handleToggleItem(item.id)}
              >
                {item.thumbnail_url ? (
                  <CachedImage className='suggest-outfit-item-img' src={resolveImageUrl(item.thumbnail_url) || ''} mode='aspectFill' />
                ) : (
                  <View className='suggest-outfit-item-placeholder'><Text>{'\uD83D\uDC55'}</Text></View>
                )}
                {selectedItemIds.includes(item.id) && (
                  <View className='suggest-outfit-item-check'>
                    <Text className='suggest-outfit-item-check-text'>{'\u2713'}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
          {selectedItemIds.length > 0 && (
            <View className='suggest-outfit-action' onClick={handleCompleteOutfit}>
              <Text className='suggest-outfit-action-text'>
                {outfitLoading ? '搜索中...' : `找搭配（已选 ${selectedItemIds.length } 件）`}
              </Text>
            </View>
          )}
        </View>
      )}

      {wardrobeItems.length < 5 && !loading && (
        <View className='suggest-cold-start'>
          <View className='suggest-cold-start-glow' />
          <View className='suggest-cold-start-icon-wrap'>
            <Image src={icons['camera']} className='suggest-cold-start-icon' style={{width: '72rpx', height: '72rpx'}} />
          </View>
          <Text className='suggest-cold-start-title'>多上传几件衣服吧</Text>
          <Text className='suggest-cold-start-desc'>衣橱至少需要 5 件衣物，AI 才能为你推荐搭配灵感</Text>
          <View className='suggest-cold-start-btn press-scale' onClick={() => Taro.navigateTo({ url: '/pages/parse/index' })}>
            <Image src={icons['camera']} style={{width: '36rpx', height: '36rpx', marginRight: '12rpx'}} />
            <Text className='suggest-cold-start-btn-text'>拍照上传</Text>
          </View>
        </View>
      )}

      {/* 补全搭配结果：按品类分组 */}
      {outfitMode && outfitGroups.length > 0 && (
        <View className='suggest-outfit-groups'>
          {outfitGroups.map((group) => (
            <View key={group.category} className='suggest-outfit-group'>
              <View className='suggest-outfit-group-header'>
                <Text className='suggest-outfit-group-label'>{group.label}</Text>
                <Text className='suggest-outfit-group-reason'>{group.reason}</Text>
              </View>
              <ScrollView scrollX className='suggest-outfit-group-scroll' enhanced showScrollbar={false}>
                <View className='suggest-outfit-group-products'>
                  {group.products.map((product, idx) => (
                    <View key={idx} className='suggest-outfit-group-card'>
                      <ProductCard
                        title={product.title}
                        picUrl={product.pic_url}
                        price={product.price}
                        originalPrice={product.original_price}
                        volume={product.volume}
                        shopTitle={product.shop_title}
                        itemUrl={product.item_url}
                        relatedItems={product.related_items}
                        index={idx}
                      />
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>
          ))}
        </View>
      )}

      {/* 你的衣橱还缺这些 + 从我的衣物出发（合并为一行，去掉游离的"已上传 N 件"开关） */}
      {!outfitMode && (gaps.length > 0 || wardrobeItems.length > 0) && (
        <View className='suggest-gaps'>
          <View className='suggest-gaps-header'>
            <Text className='suggest-gaps-icon'>{'\uD83D\uDCA1'}</Text>
            <Text className='suggest-gaps-title'>
              {gaps.length > 0 ? '\u4F60\u7684\u8863\u6A71\u8FD8\u7F3A\u8FD9\u4E9B' : '\u4ECE\u8FD9\u91CC\u5F00\u59CB\u627E\u7075\u611F'}
            </Text>
          </View>
          <ScrollView scrollX className='suggest-gaps-scroll' enhanced showScrollbar={false}>
            <View className='suggest-gaps-list'>
              {gaps.map((gap) => (
                <View key={gap.category} className={`suggest-gap-chip ${activeGap === gap.category ? 'suggest-gap-chip--active' : ''}`} onClick={() => handleGapTap(gap)}>
                  <Image src={GAP_ICONS[gap.category] || icons['shirt']} className='suggest-gap-chip-icon' style={{width: '32rpx', height: '32rpx'}} />
                  <Text className='suggest-gap-chip-label'>{gap.label}</Text>
                </View>
              ))}
              {wardrobeItems.length > 0 && (
                <View
                  className={`suggest-gap-chip suggest-gap-chip--entry ${showItemPicker ? 'suggest-gap-chip--active' : ''}`}
                  onClick={() => setShowItemPicker(!showItemPicker)}
                >
                  <Image src={icons['shirt']} className='suggest-gap-chip-icon' style={{width: '32rpx', height: '32rpx'}} />
                  <Text className='suggest-gap-chip-label'>{`\u4ECE\u6211\u7684\u8863\u7269\u51FA\u53D1 ${showItemPicker ? '\u25B2' : '\u25BC'}`}</Text>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      )}

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
          <Text className='suggest-active-item-text'>{'\u2728 \u57FA\u4E8E\u300C'}{activeItemName || '\u8863\u7269'}{'\u300D\u627E\u642D\u914D'}</Text>
          <Text className='suggest-active-item-clear' onClick={() => {
            setActiveItemId('')
            setActiveItemName('')
            loadProducts(true)
          }}>{'\u00D7'}</Text>
        </View>
      )}
      {reasonText && !activeItemId && !searchInput.trim() && (
        <View className='suggest-reason-line'>
          <Text className='suggest-reason-text'>{'\u2728 '}{reasonText}</Text>
        </View>
      )}
      {!outfitMode && (loading ? (
        <View className='suggest-product-grid'>
          <View className='suggest-product-col'><View className='skel-card skel-card--medium' /><View className='skel-card skel-card--short' /></View>
          <View className='suggest-product-col'><View className='skel-card skel-card--tall' /><View className='skel-card skel-card--medium' /></View>
        </View>
      ) : products.length > 0 ? (
        <View className='suggest-product-grid'>
          <View className='suggest-product-col'>
            {products.filter((_: any, i: number) => i % 2 === 0).map((product: any, idx: number) => (
              <ProductCard key={idx} title={product.title} picUrl={product.pic_url} price={product.price} originalPrice={product.original_price} volume={product.volume} shopTitle={product.shop_title} itemUrl={product.item_url} relatedItems={product.related_items || getRelatedItems()} reason={cardReason} index={idx} />
            ))}
          </View>
          <View className='suggest-product-col'>
            {products.filter((_: any, i: number) => i % 2 === 1).map((product: any, idx: number) => (
              <ProductCard key={idx} title={product.title} picUrl={product.pic_url} price={product.price} originalPrice={product.original_price} volume={product.volume} shopTitle={product.shop_title} itemUrl={product.item_url} relatedItems={product.related_items || getRelatedItems()} reason={cardReason} index={idx} />
            ))}
          </View>
        </View>
      ) : wardrobeItems.length >= 5 ? (
        <View className='suggest-cold-start'>
          <View className='suggest-cold-start-glow' />
          <View className='suggest-cold-start-icon-wrap'>
            <Image src={icons['sparkles']} className='suggest-cold-start-icon' style={{width: '72rpx', height: '72rpx'}} />
          </View>
          <Text className='suggest-cold-start-title'>暂无推荐商品</Text>
          <Text className='suggest-cold-start-desc'>换个场景试试，或选择一件衣物找搭配</Text>
        </View>
      ) : (
        <View className='suggest-cold-start'>
          <View className='suggest-cold-start-glow' />
          <View className='suggest-cold-start-icon-wrap'>
            <Image src={icons['sparkles']} className='suggest-cold-start-icon' style={{width: '72rpx', height: '72rpx'}} />
          </View>
          <Text className='suggest-cold-start-title'>你的 AI 造型师已就位</Text>
          <Text className='suggest-cold-start-desc'>上传你的第一件衣服，解锁无限穿搭灵感</Text>
          <View className='suggest-cold-start-btn press-scale' onClick={() => Taro.navigateTo({ url: '/pages/parse/index' })}>
            <Image src={icons['camera']} style={{width: '36rpx', height: '36rpx', marginRight: '12rpx'}} />
            <Text className='suggest-cold-start-btn-text'>拍照上传</Text>
          </View>
        </View>
      ))}

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
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set())
  const requestIdRef = useRef(0)
  // 池子等待：后台生成时的轮询与弹窗
  const poolPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const poolWaitRef = useRef<(() => void) | null>(null)
  const [incomingItemId, setIncomingItemId] = useState('')
  const [occasion, setOccasion] = useState('casual')
  const tryOnPollRef = useRef<NodeJS.Timeout | null>(null)

  // --- Virtual Try-On ---
  const [tryOnVisible, setTryOnVisible] = useState(false)
  const [tryOnItemIds, setTryOnItemIds] = useState<string[]>([])
  const [tryOnItemNames, setTryOnItemNames] = useState<string[]>([])

  const handleTryOn = useCallback((itemIds: string[], itemNames: string[]) => {
    setTryOnItemIds(itemIds)
    setTryOnItemNames(itemNames)
    setTryOnVisible(true)
  }, [])

  // Poll for try-on image updates
  const startTryOnPolling = useCallback((outfitIds: string[]) => {
    if (tryOnPollRef.current) clearInterval(tryOnPollRef.current)

    let pollCount = 0
    const maxPolls = 30 // Max 5 minutes (30 * 10s)

    tryOnPollRef.current = setInterval(async () => {
      pollCount++
      if (pollCount > maxPolls || outfitIds.length === 0) {
        if (tryOnPollRef.current) clearInterval(tryOnPollRef.current)
        return
      }

      try {
        const updated = await api.post<any[]>('/outfits/batch-check', { ids: outfitIds })
        if (updated && Array.isArray(updated)) {
          setOutfits(prev => {
            const next = [...prev]
            let changed = false
            for (const u of updated) {
              const idx = next.findIndex(o => o.id === u.id)
              if (idx >= 0 && u.model_image_url && !next[idx].model_image_url) {
                next[idx] = { ...next[idx], model_image_url: u.model_image_url }
                changed = true
              }
            }
            // If all have images, stop polling
            if (next.every(o => o.model_image_url)) {
              if (tryOnPollRef.current) clearInterval(tryOnPollRef.current)
            }
            return changed ? next : prev
          })
        }
      } catch (err) {
        console.error('Try-on polling failed:', err)
      }
    }, 10000) // Poll every 10 seconds
  }, [])

  // GET /outfits/feed — 从预生成图库秒取 2 套推荐；换下一组只发生在点「换一批推荐」时
  const fetchOutfits = useCallback(async (occasionOverride?: string) => {
    const requestId = ++requestIdRef.current

    setLoading(true)
    setOutfits([])

    try {
      const params: Record<string, string> = {}
      const queryOccasion = occasionOverride ?? occasion
      if (queryOccasion) params.occasion = queryOccasion

      const data = await api.get<{
        outfits: OutfitRecommendation[]
        pool: { ready: number; target: number; replenishing: boolean; budget_left: number }
      }>('/outfits/feed', params, { timeout: 20000 })

      if (requestId !== requestIdRef.current) return

      const list = data?.outfits || []
      setOutfits(list)
      const idsNeedingTryOn = list.filter(o => !o.model_image_url).map(o => o.id)
      if (idsNeedingTryOn.length > 0) {
        startTryOnPolling(idsNeedingTryOn)
      }

      const pool = data?.pool
      if (pool && pool.ready < 2) {
        // 图库见底（新用户/换了模特）：后台自动补货，并告知用户可先去逛逛
        api.post('/outfits/prewarm', {}, { timeout: 10000 }).catch(() => {})
        if (pool.replenishing || pool.budget_left > 0) {
          poolWaitRef.current?.()
        }
      }
    } catch (err: any) {
      if (requestId === requestIdRef.current) {
        console.error('Failed to load outfits:', err)
        if (err?.status !== 400) {
          Taro.showToast({ title: '推荐没拿到，稍后再试试', icon: 'none' })
        }
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [occasion, startTryOnPolling])

  // 池子等待实现：弹窗告知 + 20 秒轮询，就绪后自动刷新
  poolWaitRef.current = () => {
    if (poolPollRef.current) return
    Taro.showModal({
      title: '新一批搭配生成中',
      content: '大约需要几分钟。你可以先去逛逛，好了会在首页提醒你～',
      confirmText: '先去逛逛',
      cancelText: '就在这看看',
      success: (res) => {
        if (res.confirm) Taro.switchTab({ url: '/pages/home/index' })
      },
    })
    poolPollRef.current = setInterval(async () => {
      try {
        const probe = await api.post<{ pool: { ready: number } }>(
          '/outfits/prewarm', {}, { timeout: 15000 }
        )
        if ((probe?.pool?.ready || 0) >= 2) {
          if (poolPollRef.current) {
            clearInterval(poolPollRef.current)
            poolPollRef.current = null
          }
          Taro.showToast({ title: '新搭配已就绪！', icon: 'success' })
          fetchOutfits()
        }
      } catch {
        // 继续轮询
      }
    }, 20000)
  }

  // 首屏加载 + 检查从衣物详情跳转过来的 item_id
  useDidShow(() => {
    const storedItemId = Taro.getStorageSync('suggest_item_id')
    const forceRefreshRaw = Taro.getStorageSync('suggest_force_refresh')
    if (storedItemId) {
      Taro.removeStorageSync('suggest_item_id')
      setIncomingItemId(storedItemId)
      setActiveTab('product')
    } else if (forceRefreshRaw) {
      // 刚有试穿完成（首页通知标记）：复位场景并重新取图，让新结果出现在第一波
      Taro.removeStorageSync('suggest_force_refresh')
      let occasionToUse = 'casual'
      try {
        occasionToUse = JSON.parse(forceRefreshRaw)?.occasion || 'casual'
      } catch {
        // 旧格式/异常值，用默认场景
      }
      setOccasion(occasionToUse)
      setActiveTab('ai')
      fetchOutfits(occasionToUse)
    } else if (activeTab === 'ai' && outfits.length === 0) {
      fetchOutfits()
    }
  })

  // 下拉刷新
  usePullDownRefresh(() => {
    if (activeTab === 'ai') {
      fetchOutfits().then(() => Taro.stopPullDownRefresh())
    } else {
      // 灵感页的刷新逻辑在子组件里（这里原先误引用了不存在的 loadProducts，会直接报错）
      Taro.stopPullDownRefresh()
    }
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
    fetchOutfits()
  }, [fetchOutfits])

  const renderOutfitCard = useCallback(
    (outfit: OutfitRecommendation, index: number, variant: 'default' | 'solo' | 'solo-wide') => (
      <OutfitCardEnhanced
        key={outfit.id}
        id={outfit.id}
        items={outfit.items}
        modelImageUrl={outfit.model_image_url}
        occasion={outfit.occasion}
        likeCount={outfit.like_count}
        isLiked={likedIds.has(outfit.id) || outfit.is_liked_by_me}
        index={index}
        variant={variant}
        onLike={handleLike}
        onTryOn={handleTryOn}
      />
    ),
    [likedIds, handleLike, handleTryOn]
  )

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
          {/* 场景选择器 */}
          <ScrollView className='occasion-selector' scrollX enableFlex>
            {OCCASION_OPTIONS.map(o => (
              <View
                key={o.key}
                className={`occasion-tag ${occasion === o.key ? 'occasion-tag--active' : ''}`}
                onClick={() => {
                  setOccasion(o.key)
                  fetchOutfits()
                }}
              >
                <Text className='occasion-tag-icon'>{o.icon}</Text>
                <Text className='occasion-tag-label'>{o.label}</Text>
              </View>
            ))}
          </ScrollView>

          {/* 加载进度提示 */}
          {loading && (
            <View className='suggest-loading-state'>
              <View className='suggest-loading-spinner' />
              <Text className='suggest-loading-text'>AI 正在为你搭配...</Text>
              <Text className='suggest-loading-hint'>预计需要 10-20 秒</Text>
            </View>
          )}

          {/* 骨架屏加载 */}
          {loading && (
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
          )}

          {/* 每批固定 2 套竖版大图卡片（只剩 1 套时全宽）；换下一组只会发生在点「换一批推荐」时 */}
          {!loading && outfits.length > 0 && (
            <>
              {outfits.length === 1 ? (
                <View className='suggest-solo'>{renderOutfitCard(outfits[0], 0, 'solo-wide')}</View>
              ) : (
                <View className='suggest-waterfall'>
                  <View className='suggest-col'>
                    {outfits
                      .map((outfit, gi) => ({ outfit, gi }))
                      .filter(({ gi }) => gi % 2 === 0)
                      .map(({ outfit, gi }) => renderOutfitCard(outfit, gi, 'solo'))}
                  </View>
                  <View className='suggest-col'>
                    {outfits
                      .map((outfit, gi) => ({ outfit, gi }))
                      .filter(({ gi }) => gi % 2 === 1)
                      .map(({ outfit, gi }) => renderOutfitCard(outfit, gi, 'solo'))}
                  </View>
                </View>
              )}

              {/* 刷新按钮 */}
              <View className='suggest-refresh-btn' onClick={handleRefreshAll}>
                <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['refresh-cw']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='suggest-refresh-text'>换一批推荐</Text></View>
              </View>
            </>
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


