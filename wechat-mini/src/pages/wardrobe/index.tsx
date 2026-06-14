import { View, Text, ScrollView, Image} from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import { api, resolveImageUrl } from '../../utils/api'
import { uploadFile } from '../../utils/upload'
import CachedImage from '../../components/CachedImage'
import VirtualTryOnModal from '../../components/VirtualTryOnModal'
import { ClothingItem } from '../../types'
import { getItemDisplayName, getTypeLabel } from '../../constants'
import './index.scss'
import { icons } from '../../constants/icons'

interface ItemsResponse {
  items: ClothingItem[]
  total: number
  page: number
  page_size: number
  has_more: boolean
}

interface TypeGroup {
  type: string
  label: string
  icon: string
  items: ClothingItem[]
  collapsed: boolean
}

const TYPE_ICONS: Record<string, string> = {
  tshirt: icons['shirt'], shirt: icons['shirt'], blouse: icons['shirt'], top: icons['shirt'],
  sweater: icons['shirt'], hoodie: icons['shirt'],
  blazer: icons['briefcase'], jacket: icons['shirt'], coat: icons['shirt'], vest: icons['shirt'],
  pants: icons['shirt'], jeans: icons['shirt'], shorts: icons['shirt'], skirt: icons['shirt'],
  dress: icons['shirt'],
  shoes: icons['shirt'], sneakers: icons['shirt'], boots: icons['shirt'], sandals: icons['shirt'], loafers: icons['shirt'],
  hat: icons['crown'], cap: icons['crown'],
  bag: icons['briefcase'],
  scarf: icons['shirt'], belt: icons['shirt'], watch: '⌚', sunglasses: icons['sun'],
  jewelry: icons['gem'], accessory: icons['shirt'], underwear: icons['shirt'], socks: icons['shirt'],
}

export default function WardrobePage() {
  const [items, setItems] = useState<ClothingItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ total: 0, favorites: 0, needsWash: 0 })
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set())
  const [showSortPopup, setShowSortPopup] = useState(false)
  const [displayMode, setDisplayMode] = useState<'category' | 'color'>('category')
  const [sortMode, setSortMode] = useState<'default' | 'wear_count' | 'purchase_price' | 'created_at'>('default')
  const [closetTab, setClosetTab] = useState<'wardrobe' | 'tryon'>('wardrobe')
  const [contentKey, setContentKey] = useState(0)
  const [tryOnVisible, setTryOnVisible] = useState(false)
  const [tryOnItemIds, setTryOnItemIds] = useState<string[]>([])
  const [tryOnItemNames, setTryOnItemNames] = useState<string[]>([])
  const [selectedTryOnItems, setSelectedTryOnItems] = useState<Set<string>>(new Set())
  const [editMode, setEditMode] = useState(false)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [contextMenu, setContextMenu] = useState<{itemId: string; itemName: string; x: number; y: number} | null>(null)
  const pageSize = 30
  const currentPageRef = useRef(1)

  useDidShow(() => {
    loadItems(true)
  })

  useEffect(() => {
    loadItems(true)
    setContentKey(prev => prev + 1)
  }, [closetTab, sortMode])

  const handleTryOnSingle = useCallback((itemId: string, itemName: string) => {
    setTryOnItemIds([itemId])
    setTryOnItemNames([itemName])
    setTryOnVisible(true)
  }, [])

  const handleTryOnSelected = useCallback(() => {
    const ids = Array.from(selectedTryOnItems)
    if (ids.length === 0) return
    const names = items.filter(i => ids.includes(i.id)).map(i => i.name || getTypeLabel(i.type))
    setTryOnItemIds(ids)
    setTryOnItemNames(names)
    setTryOnVisible(true)
  }, [selectedTryOnItems, items])


  const handleEditTryOnSelected = useCallback(() => {
    const ids = Array.from(selectedItems)
    if (ids.length === 0) return
    const names = items.filter(i => ids.includes(i.id)).map(i => i.name || getTypeLabel(i.type))
    setTryOnItemIds(ids)
    setTryOnItemNames(names)
    setTryOnVisible(true)
  }, [selectedItems, items])
  const toggleTryOnSelect = useCallback((itemId: string) => {
    setSelectedTryOnItems(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }, [])

  const toggleEditMode = useCallback(() => {
    setEditMode(prev => {
      if (prev) { setSelectedItems(new Set()); setSelectedTryOnItems(new Set()) }
      return !prev
    })
  }, [])

  const toggleItemSelect = useCallback((itemId: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }, [])

  const selectAllItems = useCallback(() => {
    if (selectedItems.size === items.length) {
      setSelectedItems(new Set())
    } else {
      setSelectedItems(new Set(items.map(i => i.id)))
    }
  }, [items, selectedItems.size])

  const loadItems = async (reset: boolean = true) => {
    if (reset) {
      setLoading(true)
      setItems([])
      currentPageRef.current = 1
    } else {
      if (loadingMore || !hasMore) return
      setLoadingMore(true)
      currentPageRef.current += 1
    }

    const page = reset ? 1 : currentPageRef.current

    try {
      const params: Record<string, string> = {
        page: String(page),
        page_size: String(pageSize),
      }

      if (closetTab === 'wardrobe') {
        params.source_scene = 'commodity'
      } else {
        params.tryon_ready = 'true'
      }

      // Sorting
      if (sortMode !== 'default') {
        params.sort_by = sortMode
        params.sort_order = sortMode === 'wear_count' ? 'desc' : 'desc'
      }

      const data = await api.get<ItemsResponse>('/items', params)
      const fetchedItems = data.items || []

      if (reset) {
        setItems(fetchedItems)
        // Calculate stats from all items
        const favCount = fetchedItems.filter(i => (i as any).favorite).length
        const washCount = fetchedItems.filter(i => (i as any).needs_wash).length
        setStats({ total: data.total || 0, favorites: favCount, needsWash: washCount })
      } else {
        setItems(prev => {
          const existingIds = new Set(prev.map(i => i.id))
          const newItems = fetchedItems.filter(i => !existingIds.has(i.id))
          return [...prev, ...newItems]
        })
      }

      setTotal(data.total || 0)
      setHasMore(data.has_more ?? false)
    } catch (err) {
      console.error('Failed to load items:', err)
      Taro.showToast({ title: '加载出了点问题', icon: 'none' })
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  const handleBatchDelete = useCallback(async () => {
    if (selectedItems.size === 0) return
    const count = selectedItems.size
    const res = await Taro.showModal({
      title: '确认删除',
      content: `确定要删除选中的 ${count} 件衣物吗？删除后无法恢复。`,
      confirmText: '删除',
      confirmColor: '#FF4136',
    })
    if (!res.confirm) return
    setDeleting(true)
    try {
      const result = await api.post<{ deleted: number; failed: number }>('/items/bulk/delete', {
        item_ids: Array.from(selectedItems),
      })
      Taro.showToast({ title: `已删除 ${result.deleted || count} 件`, icon: 'success' })
      setSelectedItems(new Set())
      setEditMode(false)
      loadItems(true)
    } catch (err) {
      console.error('Batch delete failed:', err)
      Taro.showToast({ title: '删除失败，再试试', icon: 'none' })
    } finally {
      setDeleting(false)
    }
  }, [selectedItems, loadItems])

  const handleAddItem = async () => {
    const sceneType = closetTab === 'tryon' ? 'outfit' : 'flat'
    try {
      const res = await Taro.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['camera', 'album'],
        sizeType: ['compressed'],
      })
      if (!res.tempFiles?.length) return
      const filePath = res.tempFiles[0].tempFilePath
      // Navigate to parse page with the image already selected
      Taro.navigateTo({ url: `/pages/parse/index?tab=${sceneType}&auto=1&img=${encodeURIComponent(filePath)}` })
    } catch (err) {
      // User cancelled - do nothing
    }
  }

  const handleItemTap = (item: ClothingItem) => {
    Taro.navigateTo({ url: `/pages/item-detail/index?id=${item.id}` })
  }

  const handleLongPress = useCallback((item: ClothingItem, e: any) => {
    if (editMode) return
    // Use touch coordinates for positioning
    const touch = e.touches?.[0] || {}
    setContextMenu({
      itemId: item.id,
      itemName: item.name || getTypeLabel(item.type),
      x: touch.clientX || 200,
      y: touch.clientY || 400,
    })
  }, [editMode])

  const handleContextMenuAction = useCallback(async (action: string) => {
    if (!contextMenu) return
    const { itemId, itemName } = contextMenu
    setContextMenu(null)

    // Find current item for toggle operations
    const currentItem = items.find(i => i.id === itemId)

    switch (action) {
      case 'detail':
        Taro.navigateTo({ url: `/pages/item-detail/index?id=${itemId}` })
        break
      case 'favorite':
        try {
          const newFav = !(currentItem as any)?.favorite
          await api.patch(`/items/${itemId}`, { favorite: newFav })
          Taro.showToast({ title: newFav ? '已收藏' : '已取消收藏', icon: 'success', duration: 1000 })
          loadItems(true)
        } catch (e) { Taro.showToast({ title: '操作失败', icon: 'none' }) }
        break
      case 'wash':
        try {
          await api.post(`/items/${itemId}/log-wash`, { washed_at: new Date().toISOString().slice(0, 10) })
          Taro.showToast({ title: '已记录清洗', icon: 'success', duration: 1000 })
          loadItems(true)
        } catch (e) { Taro.showToast({ title: '操作失败', icon: 'none' }) }
        break
      case 'delete':
        Taro.showModal({
          title: '确认删除',
          content: `确定要删除「${itemName}」吗？`,
          confirmColor: '#E53E3E',
          success: async (res) => {
            if (res.confirm) {
              try {
                await api.delete(`/items/${itemId}`)
                Taro.showToast({ title: '已删除', icon: 'success', duration: 1000 })
                loadItems(true)
              } catch (e) { Taro.showToast({ title: '删除失败', icon: 'none' }) }
            }
          }
        })
        break
    }
  }, [contextMenu, items, loadItems])

  const toggleTypeCollapse = (type: string) => {
    setCollapsedTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }

  const getGroupedItems = (): TypeGroup[] => {
    const groups: Record<string, ClothingItem[]> = {}
    items.forEach(item => {
      let key: string
      if (displayMode === 'color') {
        key = (item as any).primary_color || 'unknown'
      } else {
        key = item.type || 'unknown'
      }
      if (!groups[key]) groups[key] = []
      groups[key].push(item)
    })
    return Object.entries(groups)
      .map(([type, groupItems]) => ({
        type,
        label: displayMode === 'color' ? (type || '未知') : getTypeLabel(type),
        icon: displayMode === 'color' ? '🎨' : (TYPE_ICONS[type] || icons['shirt']),
        items: groupItems,
        collapsed: collapsedTypes.has(type),
      }))
      .sort((a, b) => b.items.length - a.items.length)
  }

  const groupedItems = useMemo(() => getGroupedItems(), [items, collapsedTypes, displayMode])

  const renderItemCard = (item: ClothingItem) => (
    <View
      key={item.id}
      className='wardrobe-item'
      onClick={() => handleItemTap(item)}
      onLongPress={(e) => handleLongPress(item, e)}
    >
      <View className='wardrobe-item-img-wrap'>
        {item.thumbnail_url ? (
          <CachedImage
            className='wardrobe-item-img'
            src={resolveImageUrl(item.thumbnail_url) || ''}
            mode='aspectFit'
          />
        ) : (
          <View className='wardrobe-item-placeholder'>
            <Image src={icons['shirt']} className='wardrobe-item-placeholder-emoji' style={{width: '48rpx', height: '48rpx'}} />
          </View>
        )}
        {item.favorite && (
          <View className='wardrobe-item-fav'>
            <Image src={icons['star']} style={{width: '24rpx', height: '24rpx'}} />
          </View>
        )}
        {item.wear_count > 0 && (
          <View className='wardrobe-item-wear-count'>
            <Text className='wardrobe-item-wear-count-text'>{item.wear_count}</Text>
          </View>
        )}
      </View>
      <View className='wardrobe-item-info'>
        <Text className='wardrobe-item-name'>{getItemDisplayName(item.name, item.type)}</Text>
      </View>
      {item.needs_wash && (
        <View className='wardrobe-item-wash-badge'>
          <Text className='wardrobe-item-wash-text'>洗</Text>
        </View>
      )}
      {editMode && (
        <View
          className={`wardrobe-edit-check ${selectedItems.has(item.id) ? 'wardrobe-edit-check--checked' : ''}`}
          onClick={(e) => { e.stopPropagation(); toggleItemSelect(item.id) }}
        >
          <Text className='wardrobe-edit-check-icon'>{selectedItems.has(item.id) ? '✓' : ''}</Text>
        </View>
      )}
      {closetTab === 'wardrobe' && !editMode && (
        <>
          <View
            className={`wardrobe-item-select-check ${selectedTryOnItems.has(item.id) ? 'wardrobe-item-select-check--checked' : ''}`}
            onClick={(e) => { e.stopPropagation(); toggleTryOnSelect(item.id) }}
          >
            <Text className='wardrobe-item-select-check-icon'>{selectedTryOnItems.has(item.id) ? '✓' : ''}</Text>
          </View>
          <View
            className='wardrobe-item-tryon-btn'
            onClick={(e) => { e.stopPropagation(); handleTryOnSingle(item.id, item.name || getTypeLabel(item.type)) }}
          >
            <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['eye']} style={{width: '32rpx', height: '32rpx', marginRight: '6rpx'}} /><Text className='wardrobe-item-tryon-btn-text'>试穿</Text></View>
          </View>
        </>
      )}
    </View>
  )

  const SORT_OPTIONS = [
    { key: 'category', label: '按分类展示', isDisplay: true },
    { key: 'color', label: '按颜色展示', isDisplay: true },
    { key: 'default', label: '默认排序', isDisplay: false },
    { key: 'wear_count', label: '按穿着次数排序（OOTD）', isDisplay: false },
    { key: 'purchase_price', label: '按穿着成本排序（CPW）', isDisplay: false },
    { key: 'created_at', label: '按购买时间排序', isDisplay: false },
  ]

  return (
    <View className='wardrobe-page'>
      {/* Title + Filter */}
      <View className='wardrobe-top-bar'>
        <Text className='wardrobe-title'>我的衣橱</Text>
        <View className='wardrobe-filter-chip' onClick={() => setShowSortPopup(true)}>
          <Image src={icons['filter']} className='wardrobe-filter-chip-icon' style={{width: '28rpx', height: '28rpx'}} />
          <Text className='wardrobe-filter-chip-text'>排序</Text>
        </View>
      </View>

      {/* Dual closet tabs */}
      <View className='wardrobe-closet-tabs'>
        <View
          className={`wardrobe-closet-tab ${closetTab === 'wardrobe' ? 'wardrobe-closet-tab--active' : ''}`}
          onClick={() => setClosetTab('wardrobe')}
        >
          <Image src={icons['shirt']} className='wardrobe-closet-tab-icon' style={{width: '48rpx', height: '48rpx'}} />
          <Text className='wardrobe-closet-tab-text'>电子衣橱</Text>
        </View>
        <View
          className={`wardrobe-closet-tab ${closetTab === 'tryon' ? 'wardrobe-closet-tab--active' : ''}`}
          onClick={() => setClosetTab('tryon')}
        >
          <Image src={icons['user']} className='wardrobe-closet-tab-icon' style={{width: '48rpx', height: '48rpx'}} />
          <Text className='wardrobe-closet-tab-text'>试衣间</Text>
        </View>
      </View>

      {/* ===== Stats Bar ===== */}
      {!loading && closetTab === 'wardrobe' && (
        <View className='wardrobe-stats'>
          <View className='wardrobe-stat'>
            <Text className='wardrobe-stat-value'>{stats.total}</Text>
            <Text className='wardrobe-stat-label'>全部</Text>
          </View>
          <View className='wardrobe-stat-divider' />
          <View className='wardrobe-stat'>
            <Text className='wardrobe-stat-value'>{stats.favorites}</Text>
            <Text className='wardrobe-stat-label'>收藏</Text>
          </View>
          <View className='wardrobe-stat-divider' />
          <View className='wardrobe-stat'>
            <Text className='wardrobe-stat-value'>{stats.needsWash}</Text>
            <Text className='wardrobe-stat-label'>待洗</Text>
          </View>
        </View>
      )}

      {/* Toolbar */}
      <View className='wardrobe-toolbar'>
        <View className='wardrobe-toolbar-left'>
          <View style={{display: 'flex', alignItems: 'center'}} onClick={() => Taro.navigateTo({ url: '/pages/analytics/index' })}><Image src={icons['clock']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='wardrobe-toolbar-stats'>衣橱统计</Text></View>
          <View style={{display: 'flex', alignItems: 'center'}} onClick={() => Taro.showToast({ title: '即将开放', icon: 'none' })}><Image src={icons['settings']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='wardrobe-toolbar-settings'>衣橱设置</Text></View>
          <View className='wardrobe-toolbar-new-badge'>
            <Text className='wardrobe-toolbar-new-text'>NEW</Text>
          </View>
        </View>
        <View style='display:flex;align-items:center;gap:16rpx'>
          <View className='wardrobe-manage-btn' onClick={toggleEditMode}>
            <Text className='wardrobe-manage-btn-text'>{editMode ? '完成' : '管理'}</Text>
          </View>
          <View className='wardrobe-toolbar-sort' onClick={() => setShowSortPopup(true)}>
            <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['refresh-cw']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='wardrobe-toolbar-sort-text'>排序展示</Text></View>
          </View>
        </View>
      </View>

      {/* Content */}
      <ScrollView scrollY className='wardrobe-scroll wardrobe-content-anim' key={contentKey}>
        {/* Grouped View */}
        {groupedItems.map((group, _gIdx) => (
          <View key={group.type} className='wardrobe-group'>
            <View
              className='wardrobe-group-header'
              onClick={() => toggleTypeCollapse(group.type)}
            >
              <View className='wardrobe-group-header-left'>
                <Image src={group.icon} className='wardrobe-group-icon' style={{width: '48rpx', height: '48rpx'}} />
                <Text className='wardrobe-group-title'>{group.label}</Text>
              </View>
              <View className='wardrobe-group-header-right'>
                <Text className='wardrobe-group-count'>{group.items.length}</Text>
                <Image src={icons[group.collapsed ? 'chevron-right' : 'chevron-down']} className='wardrobe-group-arrow' style={{width: '28rpx', height: '28rpx'}} />
              </View>
            </View>
            {!group.collapsed && (
              <View className='wardrobe-group-grid'>
                {group.items.map(item => renderItemCard(item))}
              </View>
            )}
          </View>
        ))}

        {loading && (
          <View className='loading-global'>
            <Text className='loading-global-text'>加载中...</Text>
          </View>
        )}

        {!loading && items.length === 0 && closetTab === 'wardrobe' && (
          <View className='empty-state'>
            <Image src={icons['shirt']} className='empty-state-icon' style={{width: '48rpx', height: '48rpx'}} />
            <Text className='empty-state-title'>衣橱空空如也</Text>
            <Text className='empty-state-desc'>点击下方 + 拍照添加你的第一件衣物</Text>
          </View>
        )}

        {closetTab === 'tryon' && items.length === 0 && !loading && (
          <View className='wardrobe-empty-tryon'>
            <Image src={icons['shirt']} className='wardrobe-empty-tryon-icon' style={{width: '48rpx', height: '48rpx'}} />
            <Text className='wardrobe-empty-tryon-title'>试衣间还是空的</Text>
            <Text className='wardrobe-empty-tryon-desc'>上传穿搭照，AI 帮你拆分入库后即可虚拟试穿</Text>
            <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['lightbulb']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='wardrobe-empty-tryon-hint'>在衣物详情页可以补拍上身照，解锁试穿</Text></View>
            <View className='wardrobe-empty-tryon-btn' onClick={() => Taro.navigateTo({ url: '/pages/parse/index?tab=outfit' })}>
              <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['camera']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='wardrobe-empty-tryon-btn-text'>上传穿搭照</Text></View>
            </View>
          </View>
        )}

        {!loading && hasMore && items.length > 0 && (
          <View className='wardrobe-load-more' onClick={() => loadItems(false)}>
            <Text className='wardrobe-load-more-text'>
              {loadingMore ? '加载中...' : '加载更多'}
            </Text>
          </View>
        )}

        {/* Bottom Padding */}
        <View style={{ height: '260rpx' }} />
      </ScrollView>

      {/* Floating Add Button */}
      <View className='wardrobe-fab' onClick={handleAddItem}>
        <Image src={icons['camera']} className='wardrobe-fab-icon' />
      </View>

      {/* Context Menu Overlay */}
      {contextMenu && (
        <View className='ctx-overlay' onClick={() => setContextMenu(null)}>
          <View className='ctx-menu animate-fade-in-up' style={{top: Math.max(80, Math.min(contextMenu.y - 60, 600)) + 'px', left: Math.min(contextMenu.x, 400) + 'rpx'}}>
            <View className='ctx-menu-item' onClick={() => handleContextMenuAction('detail')}>
              <Image src={icons['eye']} className='ctx-menu-icon' style={{width: '32rpx', height: '32rpx'}} />
              <Text className='ctx-menu-text'>查看详情</Text>
            </View>
            <View className='ctx-menu-item' onClick={() => handleContextMenuAction('favorite')}>
              <Image src={icons['heart']} className='ctx-menu-icon' style={{width: '32rpx', height: '32rpx'}} />
              <Text className='ctx-menu-text'>{(items.find(i => i.id === contextMenu.itemId) as any)?.favorite ? '取消收藏' : '标记收藏'}</Text>
            </View>
            <View className='ctx-menu-item' onClick={() => handleContextMenuAction('wash')}>
              <Image src={icons['droplets']} className='ctx-menu-icon' style={{width: '32rpx', height: '32rpx'}} />
              <Text className='ctx-menu-text'>记录清洗</Text>
            </View>
            <View className='ctx-menu-divider' />
            <View className='ctx-menu-item ctx-menu-item--danger' onClick={() => handleContextMenuAction('delete')}>
              <Image src={icons['trash-2']} className='ctx-menu-icon' style={{width: '32rpx', height: '32rpx'}} />
              <Text className='ctx-menu-text'>删除衣物</Text>
            </View>
          </View>
        </View>
      )}

      {/* Sort Popup */}
      {showSortPopup && (
        <View className='sort-overlay' onClick={() => setShowSortPopup(false)}>
          <View className='sort-popup animate-slide-up' onClick={e => e.stopPropagation()}>
            <View className='sort-popup-handle' />
            <Text className='sort-popup-title'>展示设置</Text>
            {SORT_OPTIONS.filter(o => o.isDisplay).map(opt => (
              <View
                key={opt.key}
                className='sort-option'
                onClick={() => { setDisplayMode(opt.key as any); setShowSortPopup(false) }}
              >
                <Text className='sort-option-label'>{opt.label}</Text>
                <View className={`sort-radio ${displayMode === opt.key ? 'sort-radio--active' : ''}`}>
                  {displayMode === opt.key && <Image src={icons['check']} className='sort-radio-dot' style={{width: '48rpx', height: '48rpx'}} />}
                </View>
              </View>
            ))}

            <View className='sort-divider' />

            <Text className='sort-popup-title'>排序设置</Text>
            {SORT_OPTIONS.filter(o => !o.isDisplay).map(opt => (
              <View
                key={opt.key}
                className='sort-option'
                onClick={() => { setSortMode(opt.key as any); setShowSortPopup(false) }}
              >
                <Text className='sort-option-label'>{opt.label}</Text>
                <View className={`sort-radio ${sortMode === opt.key ? 'sort-radio--active' : ''}`}>
                  {sortMode === opt.key && <Image src={icons['check']} className='sort-radio-dot' style={{width: '48rpx', height: '48rpx'}} />}
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ===== Unified Bottom Action Bars ===== */}

      {/* 1. Non-edit try-on: quick try-on selection bar */}
      {closetTab === 'wardrobe' && !editMode && selectedTryOnItems.size > 0 && (
        <View className="wardrobe-action-bar">
          <View className="wardrobe-action-bar-inner">
            <View className="wardrobe-action-bar-info">
              <Text className="wardrobe-action-bar-count">{selectedTryOnItems.size}</Text>
              <Text className="wardrobe-action-bar-label">件已选</Text>
            </View>
            <View className="wardrobe-action-bar-btn wardrobe-action-bar-btn--primary" onClick={handleTryOnSelected}>
              <Text className="wardrobe-action-bar-btn-icon"><Image src={icons['shirt']} style={{width: '36rpx', height: '36rpx'}} /></Text>
              <Text className="wardrobe-action-bar-btn-text">试穿</Text>
            </View>
          </View>
        </View>
      )}

      {/* 2. Edit mode — unified batch bar (wardrobe + tryon) */}
      {editMode && (
        <View className="wardrobe-action-bar">
          <View className="wardrobe-action-bar-inner">
            <View className="wardrobe-action-bar-left">
              <View className="wardrobe-action-bar-select-all" onClick={selectAllItems}>
                <View className={`wardrobe-action-bar-checkbox ${selectedItems.size === items.length && items.length > 0 ? 'wardrobe-action-bar-checkbox--checked' : ''}`}>
                  {selectedItems.size === items.length && items.length > 0 && <Text className="wardrobe-action-bar-checkbox-icon">✓</Text>}
                </View>
                <Text className="wardrobe-action-bar-select-text">全选</Text>
              </View>
              <Text className="wardrobe-action-bar-count-label">{selectedItems.size} 件</Text>
            </View>
            <View className="wardrobe-action-bar-right">
              {closetTab === 'wardrobe' && (
                <View
                  className={`wardrobe-action-bar-btn wardrobe-action-bar-btn--primary ${selectedItems.size === 0 ? 'wardrobe-action-bar-btn--disabled' : ''}`}
                  onClick={selectedItems.size > 0 ? handleEditTryOnSelected : undefined}
                >
                  <Text className="wardrobe-action-bar-btn-icon"><Image src={icons['shirt']} style={{width: '36rpx', height: '36rpx'}} /></Text>
                  <Text className="wardrobe-action-bar-btn-text">试穿</Text>
                </View>
              )}
              <View
                className={`wardrobe-action-bar-btn wardrobe-action-bar-btn--danger ${selectedItems.size === 0 ? 'wardrobe-action-bar-btn--disabled' : ''}`}
                onClick={selectedItems.size > 0 ? handleBatchDelete : undefined}
              >
                <Text className="wardrobe-action-bar-btn-icon">{deleting ? '' : <Image src={icons['trash-2']} style={{width: '36rpx', height: '36rpx'}} />}</Text>
                <Text className="wardrobe-action-bar-btn-text">{deleting ? '删除中...' : '删除'}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
      {/* Virtual Try-On Modal */}
      <VirtualTryOnModal
        visible={tryOnVisible}
        garmentItemIds={tryOnItemIds}
        garmentNames={tryOnItemNames}
        onClose={() => {
          setTryOnVisible(false)
          setSelectedTryOnItems(new Set())
        }}
      />

    </View>
  )
}
