import { View, Text, Image, ScrollView } from '@tarojs/components'
import Taro, { useDidShow, useReachBottom, usePullDownRefresh } from '@tarojs/taro'
import { useState, useRef, useCallback, useEffect } from 'react'
import { api, resolveImageUrl, completeOutfit, CompleteOutfitGroup, uploadFile } from '../../utils/api'
import OutfitCard from '../../components/OutfitCard'
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
  const [error, setError] = useState(false)
  const [activeOccasion, setActiveOccasion] = useState('all')
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null)
  const [pendingOccasion, setPendingOccasion] = useState<string | null>(null)
  const [uploadingOutfitId, setUploadingOutfitId] = useState<string | null>(null)

  // 每次显示时刷新数据（从 DIY 返回后也能看到新搭配）
  useDidShow(() => {
    loadMine()
  })

  const loadMine = async () => {
    setLoading(true)
    setError(false)
    try {
      const data = await api.get<{ outfits: any[]; total: number; has_more: boolean }>('/outfits', {
        page: '1',
        page_size: '50',
        source: 'manual',
      })
      setOutfits(data.outfits || [])
    } catch (err) {
      console.error('Load mine outfits failed:', err)
      setError(true)
    } finally {
      setLoading(false)
    }
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

      setUploadingOutfitId(outfitId)
      Taro.showLoading({ title: '上传中...' })

      const filePath = res.tempFilePaths[0]
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
  const [keywordUsed, setKeywordUsed] = useState('')

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
      setKeywordUsed(data.keyword_used || '')
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
      setKeywordUsed(data.keyword_used || '')
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

      {wardrobeItems.length >= 5 && gaps.length > 0 && !outfitMode && (
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

      {!outfitMode && (
        <View className='suggest-wardrobe-toggle' onClick={() => setShowItemPicker(!showItemPicker)}>
          <Text className='suggest-wardrobe-toggle-text'>{`\u5DF2\u4E0A\u4F20 ${wardrobeItems.length} \u4EF6\u8863\u670D ${showItemPicker ? '\u25B2' : '\u25BC'}`}</Text>
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
      {keywordUsed && !activeItemId && !searchInput.trim() && (
        <View className='suggest-keyword-banner'>
          <Text className='suggest-keyword-text'>{'\uD83D\uDCA1 '}{keywordUsed}</Text>
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
              <ProductCard key={idx} title={product.title} picUrl={product.pic_url} price={product.price} originalPrice={product.original_price} volume={product.volume} shopTitle={product.shop_title} itemUrl={product.item_url} relatedItems={product.related_items || getRelatedItems()} index={idx} />
            ))}
          </View>
          <View className='suggest-product-col'>
            {products.filter((_: any, i: number) => i % 2 === 1).map((product: any, idx: number) => (
              <ProductCard key={idx} title={product.title} picUrl={product.pic_url} price={product.price} originalPrice={product.original_price} volume={product.volume} shopTitle={product.shop_title} itemUrl={product.item_url} relatedItems={product.related_items || getRelatedItems()} index={idx} />
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
  const [loadingMore, setLoadingMore] = useState(false)
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set())
  const requestIdRef = useRef(0)
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

  // POST /outfits/suggest-batch — 一次获取多套推荐
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
      const loc = await Promise.race([
        getLocationAndSave(),
        new Promise<null>(r => setTimeout(() => r(null), 5000))
      ])

      const body: Record<string, unknown> = {
        occasion,
        count: MAX_RECOMMENDATIONS,
      }
      if (loc) {
        body.latitude = loc.latitude
        body.longitude = loc.longitude
      }

      const data = await api.post<OutfitRecommendation[]>('/outfits/suggest-batch', body, {
        timeout: 180000
      })

      if (requestId !== requestIdRef.current) return

      if (data && Array.isArray(data) && data.length > 0) {
        setOutfits(data)
        setLoading(false)

        // Start polling for try-on images
        const idsNeedingTryOn = data
          .filter(o => !o.model_image_url)
          .map(o => o.id)
        if (idsNeedingTryOn.length > 0) {
          startTryOnPolling(idsNeedingTryOn)
        }
      } else {
        if (reset) setOutfits([])
      }
    } catch (err: any) {
      if (requestId === requestIdRef.current) {
        console.error('Failed to load outfits:', err)
        if (err?.status === 400) {
          // Insufficient wardrobe
        } else if (reset) {
          Taro.showToast({ title: '推荐没拿到，稍后再试试', icon: 'none' })
        }
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [occasion, loadingMore, startTryOnPolling])

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
    if (activeTab === 'ai') {
      fetchOutfits(true).then(() => Taro.stopPullDownRefresh())
    } else if (activeTab === 'product') {
      loadProducts(true).then(() => Taro.stopPullDownRefresh())
    } else {
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
          {/* 场景选择器 */}
          <ScrollView className='occasion-selector' scrollX enableFlex>
            {OCCASIONS.map(o => (
              <View
                key={o.key}
                className={`occasion-tag ${occasion === o.key ? 'occasion-tag--active' : ''}`}
                onClick={() => {
                  setOccasion(o.key)
                  fetchOutfits(true)
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


