import { View, Text, MovableArea, MovableView, ScrollView, Image} from '@tarojs/components'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { useState, useMemo, useCallback, useEffect } from 'react'
import { api, resolveImageUrl } from '../../utils/api'
import CachedImage from '../../components/CachedImage'
import VirtualTryOnModal from '../../components/VirtualTryOnModal'
import { ClothingItem } from '../../types'
import { TYPE_LABELS, OCCASION_LABELS } from '../../constants'
import './index.scss'
import { icons } from '../../constants/icons'

// ===== Types =====

interface CanvasItem {
  id: string
  item: ClothingItem
  x: number
  y: number
  zIndex: number
}

// ===== Constants =====

const CANVAS_W = 690  // rpx, 750 - 60 padding
const CANVAS_H = 720  // rpx
const ITEM_W = 160    // rpx
const ITEM_H = 160    // rpx

const CATEGORIES = [
  { key: 'all', label: '全部' },
  { key: 'top', label: '上衣' },
  { key: 'bottom', label: '下装' },
  { key: 'shoes', label: '鞋子' },
  { key: 'accessories', label: '配饰' },
]

const CATEGORY_MAP: Record<string, string[]> = {
  top: ['tshirt', 'shirt', 'blouse', 'sweater', 'jacket', 'coat', 'vest', 'hoodie'],
  bottom: ['pants', 'jeans', 'shorts', 'skirt'],
  shoes: ['shoes', 'sneakers', 'boots', 'sandals', 'loafers'],
  accessories: ['hat', 'cap', 'scarf', 'bag', 'belt', 'watch', 'sunglasses', 'jewelry', 'accessory'],
}

// ===== Main Component =====

export default function DiyPage() {
  const router = useRouter()
  // --- Data ---
  const [items, setItems] = useState<ClothingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState('all')
  const [sheetExpanded, setSheetExpanded] = useState(true)

  // --- Canvas State ---
  const [canvasItems, setCanvasItems] = useState<CanvasItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [zCounter, setZCounter] = useState(1)

  // --- Result ---
  const [showResult, setShowResult] = useState(false)
  const [aiReasoning, setAiReasoning] = useState('')

  // --- Outfit Info ---
  const [outfitName, setOutfitName] = useState('')
  const [selectedOccasion, setSelectedOccasion] = useState('casual')

  // --- Edit Mode ---
  const [editingOutfitId, setEditingOutfitId] = useState<string | null>(null)

  // --- Virtual Try-On ---
  const [showTryOn, setShowTryOn] = useState(false)

  // ===== Data Loading =====

  useDidShow(() => {
    loadItems()
  })

  // Load existing outfit for editing
  useEffect(() => {
    const outfitId = router.params.outfit_id
    if (outfitId) {
      setEditingOutfitId(outfitId)
      loadOutfitForEdit(outfitId)
    }
  }, [router.params.outfit_id])

  const loadOutfitForEdit = async (outfitId: string) => {
    try {
      const data = await api.get<any>(`/outfits/${outfitId}`)
      if (data.name) setOutfitName(data.name)
      if (data.occasion) setSelectedOccasion(data.occasion)
      // Items will be populated after loadItems completes
      if (data.items?.length) {
        const editItems: CanvasItem[] = data.items.map((item: any, i: number) => ({
          id: item.id,
          item: item,
          x: (CANVAS_W - ITEM_W) / 2 + (i % 3 - 1) * 80,
          y: (CANVAS_H - ITEM_H) / 2 + Math.floor(i / 3) * 80,
          zIndex: i + 1,
        }))
        setCanvasItems(editItems)
        setZCounter(data.items.length + 1)
      }
    } catch (err) {
      console.error('Load outfit for edit failed:', err)
      Taro.showToast({ title: '加载搭配失败', icon: 'none' })
    }
  }

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ items: ClothingItem[] }>('/items', { page: '1', page_size: '100' })
      setItems(data.items || [])
    } catch (err) {
      console.error('Load items failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // ===== Filtered Items =====

  const filteredItems = useMemo(() => {
    if (activeCategory === 'all') return items
    const types = CATEGORY_MAP[activeCategory] || []
    return items.filter(i => types.includes(i.type))
  }, [items, activeCategory])

  const canvasItemIds = useMemo(() => new Set(canvasItems.map(c => c.id)), [canvasItems])

  // ===== Canvas Actions =====

  const addToCanvas = useCallback((item: ClothingItem) => {
    // Prevent duplicates
    if (canvasItemIds.has(item.id)) {
      Taro.showToast({ title: '这件已经在画板上了', icon: 'none' })
      return
    }

    const newZ = zCounter + 1
    setZCounter(newZ)

    // Place near center with slight random offset
    const cx = (CANVAS_W - ITEM_W) / 2 + (Math.random() - 0.5) * 100
    const cy = (CANVAS_H - ITEM_H) / 2 + (Math.random() - 0.5) * 100

    const canvasItem: CanvasItem = {
      id: item.id,
      item,
      x: Math.max(0, Math.min(cx, CANVAS_W - ITEM_W)),
      y: Math.max(0, Math.min(cy, CANVAS_H - ITEM_H)),
      zIndex: newZ,
    }

    setCanvasItems(prev => [...prev, canvasItem])
    setActiveId(item.id)
  }, [canvasItemIds, zCounter])

  const removeFromCanvas = useCallback((id: string) => {
    setCanvasItems(prev => prev.filter(c => c.id !== id))
    if (activeId === id) setActiveId(null)
  }, [activeId])

  const clearCanvas = useCallback(() => {
    Taro.showModal({
      title: '确定要清空画板吗',
      content: '画板上的所有衣物都会被移除',
      success: (res) => {
        if (res.confirm) {
          setCanvasItems([])
          setActiveId(null)
        }
      },
    })
  }, [])

  const handleDragEnd = useCallback((id: string, e: any) => {
    const { x, y } = e.detail
    setCanvasItems(prev =>
      prev.map(c => c.id === id ? { ...c, x, y } : c)
    )
  }, [])

  const bringToFront = useCallback((id: string) => {
    const newZ = zCounter + 1
    setZCounter(newZ)
    setActiveId(id)
    setCanvasItems(prev =>
      prev.map(c => c.id === id ? { ...c, zIndex: newZ } : c)
    )
  }, [zCounter])

  // ===== Save Outfit =====

  const handleSave = useCallback(async () => {
    if (canvasItems.length < 2) {
      Taro.showToast({ title: '至少放 2 件衣物再保存哦', icon: 'none' })
      return
    }

    const payload = {
      items: canvasItems.map(c => c.id),
      occasion: selectedOccasion,
      name: outfitName || undefined,
    }

    try {
      if (editingOutfitId) {
        await api.patch(`/outfits/${editingOutfitId}`, payload)
        Taro.showToast({ title: '搭配已更新', icon: 'success' })
      } else {
        await api.post('/outfits/studio', payload)
        Taro.showToast({ title: '搭配保存好了', icon: 'success' })
      }
      setTimeout(() => {
        Taro.navigateBack()
      }, 1200)
    } catch (err) {
      console.error('Save outfit failed:', err)
      Taro.showToast({ title: '保存没成功，再试一次？', icon: 'none' })
    }
  }, [canvasItems, selectedOccasion, outfitName])

  // ===== Virtual Try-On =====

  const handleVirtualTryOn = useCallback(() => {
    if (canvasItems.length < 1) {
      Taro.showToast({ title: '至少放 1 件衣物再试穿哦', icon: 'none' })
      return
    }
    setShowTryOn(true)
  }, [canvasItems])

  // ===== AI Suggestion =====

  const handleAiSuggest = useCallback(async () => {
    if (canvasItems.length < 2) {
      Taro.showToast({ title: '至少放 2 件衣物再让 AI 看看', icon: 'none' })
      return
    }
    try {
      const result = await api.post<{ reasoning: string }>('/outfits/suggest', {
        include_items: canvasItems.map(c => c.id),
        occasion: selectedOccasion,
      })
      setAiReasoning(result.reasoning || '这套搭配很不错！')
      setShowResult(true)
    } catch (err) {
      console.error('DIY suggestion failed:', err)
      Taro.showToast({ title: 'AI 没看懂，稍后再试试', icon: 'none' })
    }
  }, [canvasItems])

  // ===== Render =====

  return (
    <View className='diy-page'>
        <View className='diy-header-right'>
          {canvasItems.length > 0 && (
            <Text className='diy-header-count'>{canvasItems.length} 件</Text>
          )}
        </View>

      {/* ===== Canvas Area ===== */}
      <View className='diy-canvas-wrap'>
        <View className='diy-canvas-bg' />
        <MovableArea className='diy-canvas'>
          {canvasItems.map((ci) => (
            <MovableView
              key={ci.id}
              className={`diy-canvas-item ${activeId === ci.id ? 'diy-canvas-item--active' : ''}`}
              style={{
                width: `${ITEM_W}rpx`,
                height: `${ITEM_H}rpx`,
                zIndex: ci.zIndex,
              }}
              x={ci.x}
              y={ci.y}
              direction='all'
              damping={40}
              friction={10}
              inertia
              catchtap={() => bringToFront(ci.id)}
              onChange={(e) => handleDragEnd(ci.id, e)}
            >
              <View className='diy-canvas-item-inner'>
                {ci.item.thumbnail_url ? (
                  <CachedImage
                    className='diy-canvas-item-img'
                    src={resolveImageUrl(ci.item.thumbnail_url) || ''}
                    mode='aspectFill'
                  />
                ) : (
                  <View className='diy-canvas-item-placeholder'>
                    <Image src={icons['shirt']} className='diy-canvas-item-emoji' style={{width: '48rpx', height: '48rpx'}} />
                  </View>
                )}
                <View className='diy-canvas-item-label'>
                  <Text className='diy-canvas-item-label-text'>
                    {TYPE_LABELS[ci.item.type] || ci.item.type}
                  </Text>
                </View>
                {activeId === ci.id && (
                  <View
                    className='diy-canvas-item-remove'
                    catchtap={() => removeFromCanvas(ci.id)}
                  >
                    <Image src={icons['x']} className='diy-canvas-item-remove-text' style={{width: '48rpx', height: '48rpx'}} />
                  </View>
                )}
              </View>
            </MovableView>
          ))}

          {/* Empty Canvas Hint */}
          {canvasItems.length === 0 && (
            <View className='diy-canvas-hint'>
              <Image src={icons['arrow-up']} className='diy-canvas-hint-icon' style={{width: '48rpx', height: '48rpx'}} />
              <Text className='diy-canvas-hint-text'>从下方选一件衣服放上来</Text>
            </View>
          )}
        </MovableArea>

        {/* Canvas FABs */}
        {canvasItems.length > 0 && (
          <View className='diy-fabs'>
            <View className='diy-fab diy-fab--clear' onClick={clearCanvas}>
              <Image src={icons['trash-2']} className='diy-fab-icon' style={{width: '40rpx', height: '40rpx'}} />
            </View>
            <View className='diy-fab diy-fab--ai' onClick={handleAiSuggest}>
              <Image src={icons['bot']} className='diy-fab-icon' style={{width: '48rpx', height: '48rpx'}} />
            </View>
            <View className='diy-fab diy-fab--tryon' onClick={handleVirtualTryOn}>
              <Image src={icons['sparkles']} className='diy-fab-icon' style={{width: '48rpx', height: '48rpx'}} />
            </View>
          </View>
        )}
      </View>

      {/* ===== Bottom Drawer ===== */}
      <View className={`diy-drawer ${sheetExpanded ? 'diy-drawer--expanded' : ''}`}>
        {/* Drawer Handle */}
        <View
          className='diy-drawer-handle'
          onClick={() => setSheetExpanded(!sheetExpanded)}
        >
          <View className='diy-drawer-handle-bar' />
        </View>

        {/* Category Tabs */}
        <ScrollView scrollX className='diy-drawer-tabs'>
          <View className='diy-drawer-tabs-inner'>
            {CATEGORIES.map(cat => (
              <View
                key={cat.key}
                className={`diy-drawer-tab ${activeCategory === cat.key ? 'diy-drawer-tab--active' : ''}`}
                onClick={() => setActiveCategory(cat.key)}
              >
                <Text className='diy-drawer-tab-text'>{cat.label}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        {/* Items Grid */}
        {sheetExpanded && (
          <ScrollView scrollY className='diy-drawer-scroll'>
            {loading ? (
              <View className='diy-drawer-loading'>
                <Text className='diy-drawer-loading-text'>正在加载衣橱...</Text>
              </View>
            ) : filteredItems.length === 0 ? (
              <View className='diy-drawer-empty'>
                <Text className='diy-drawer-empty-text'>这个分类还没有衣物</Text>
              </View>
            ) : (
              <View className='diy-drawer-grid'>
                {filteredItems.map(item => {
                  const onCanvas = canvasItemIds.has(item.id)
                  return (
                    <View
                      key={item.id}
                      className={`diy-drawer-item ${onCanvas ? 'diy-drawer-item--on-canvas' : ''}`}
                      onClick={() => addToCanvas(item)}
                    >
                      {item.thumbnail_url ? (
                        <CachedImage
                          className='diy-drawer-item-img'
                          src={resolveImageUrl(item.thumbnail_url) || ''}
                          mode='aspectFill'
                        />
                      ) : (
                        <View className='diy-drawer-item-placeholder'>
                          <Image src={icons['shirt']} style={{width: '48rpx', height: '48rpx'}} />
                        </View>
                      )}
                      <Text className='diy-drawer-item-name'>
                        {item.name || TYPE_LABELS[item.type] || item.type}
                      </Text>
                      {onCanvas && (
                        <View className='diy-drawer-item-badge'>
                          <Image src={icons['check']} className='diy-drawer-item-badge-text' style={{width: '48rpx', height: '48rpx'}} />
                        </View>
                      )}
                    </View>
                  )
                })}
              </View>
            )}
            <View style={{ height: '40rpx' }} />
          </ScrollView>
        )}

        {/* Outfit Info */}
        <View className='diy-outfit-info'>
          <View className='diy-info-row'>
            <Text className='diy-info-label'>搭配名称</Text>
            <input
              className='diy-info-input'
              placeholder='给搭配起个名字（可选）'
              value={outfitName}
              onInput={(e) => setOutfitName(e.detail.value)}
            />
          </View>
          <View className='diy-info-row'>
            <Text className='diy-info-label'>场合</Text>
            <View className='diy-occasion-tags'>
              {['casual', 'work', 'date', 'formal', 'sport', 'travel', 'party'].map(occ => (
                <View
                  key={occ}
                  className={`diy-occasion-tag ${selectedOccasion === occ ? 'diy-occasion-tag--active' : ''}`}
                  onClick={() => setSelectedOccasion(occ)}
                >
                  <Text className='diy-occasion-tag-text'>
                    {OCCASION_LABELS[occ] || occ}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* Save Button */}
        <View className='diy-drawer-save' onClick={handleSave}>
          <Text className='diy-drawer-save-text'>
            {editingOutfitId ? '更新搭配' : '保存搭配'} {canvasItems.length > 0 ? `(${canvasItems.length}件)` : ''}
          </Text>
        </View>
      </View>

      {/* AI Result Modal */}
      {showResult && (
        <View className='diy-modal-overlay' onClick={() => setShowResult(false)}>
          <View className='diy-modal' onClick={(e) => e.stopPropagation()}>
            <Image src={icons['bot']} className='diy-modal-icon' style={{width: '48rpx', height: '48rpx'}} />
            <Text className='diy-modal-title'>AI 搭配点评</Text>
            <Text className='diy-modal-text'>{aiReasoning}</Text>
            <View className='diy-modal-btn' onClick={() => setShowResult(false)}>
              <Text className='diy-modal-btn-text'>知道了</Text>
            </View>
          </View>
        </View>
      )}
      {/* Virtual Try-On Modal */}
      <VirtualTryOnModal
        visible={showTryOn}
        garmentItemIds={canvasItems.map(c => c.id)}
        garmentNames={canvasItems.map(c => c.item.name || TYPE_LABELS[c.item.type] || c.item.type)}
        onClose={() => setShowTryOn(false)}
      />
    </View>
  )
}
