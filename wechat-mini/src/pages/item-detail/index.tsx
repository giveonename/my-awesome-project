import { View, Text, ScrollView, Image} from '@tarojs/components'
import Taro, { useRouter, useDidShow } from '@tarojs/taro'
import { useState, useCallback } from 'react'
import { api, uploadFile, resolveImageUrl } from '../../utils/api'
import CachedImage from '../../components/CachedImage'
import VirtualTryOnModal from '../../components/VirtualTryOnModal'
import { ClothingItem } from '../../types'
import {
  TYPE_LABELS, COLOR_MAP, COLOR_LABELS_CN, MATERIAL_LABELS_CN,
  STYLE_LABELS_CN, SEASON_LABELS_CN, FORMALITY_LABELS_CN,
  PATTERN_LABELS_CN, FIT_LABELS_CN, getTypeLabel, } from '../../constants'
import './index.scss'
import { icons } from '../../constants/icons'

interface WearHistoryEntry {
  id: string
  worn_at: string
  occasion?: string
  notes?: string
  outfit?: {
    id: string
    occasion?: string
    items: { id: string; type: string; name?: string; thumbnail_url?: string }[]
  }
}

interface WearStats {
  total_wears: number
  wears_this_month: number
  wears_this_week: number
  cost_per_wear?: number
  last_worn_at?: string
}

interface EditFormData {
  type: string
  name: string
  primary_color: string
  material: string
  brand: string
  description: string
  purchase_price: string
}

export default function ItemDetailPage() {
  const router = useRouter()
  const [item, setItem] = useState<ClothingItem | null>(null)
  const [wearHistory, setWearHistory] = useState<WearHistoryEntry[]>([])
  const [wearStats, setWearStats] = useState<WearStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<EditFormData>({
    type: '',
    name: '',
    primary_color: '',
    material: '',
    brand: '',
    description: '',
    purchase_price: '',
  })
  const [saving, setSaving] = useState(false)
  const [loggingWear, setLoggingWear] = useState(false)
  const [loggingWash, setLoggingWash] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [tryOnVisible, setTryOnVisible] = useState(false)

  const itemId = router.params.id

  const purchasePrice: number | null =
    (item as any)?.purchase_price != null ? Number((item as any).purchase_price) : null

  useDidShow(() => {
    if (itemId) {
      loadItemDetail()
    }
  })

  const loadItemDetail = async () => {
    setLoading(true)
    try {
      const [itemData, historyData, statsData] = await Promise.allSettled([
        api.get<ClothingItem>(`/items/${itemId}`),
        api.get<WearHistoryEntry[]>(`/items/${itemId}/history`, { limit: '20' }),
        api.get<WearStats>(`/items/${itemId}/wear-stats`),
      ])

      if (itemData.status === 'fulfilled') {
        setItem(itemData.value)
        setEditForm({
          type: itemData.value.type || '',
          name: itemData.value.name || '',
          primary_color: itemData.value.primary_color || '',
          material: itemData.value.material || '',
          brand: itemData.value.brand || '',
          description: itemData.value.description || '',
          purchase_price:
            (itemData.value as any).purchase_price != null
              ? String((itemData.value as any).purchase_price)
              : '',
        })
      }
      if (historyData.status === 'fulfilled') setWearHistory(historyData.value || [])
      if (statsData.status === 'fulfilled') setWearStats(statsData.value)
    } catch (err) {
      console.error('Failed to load item detail:', err)
      Taro.showToast({ title: '加载出了点问题', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  const handleSaveEdit = async () => {
    setSaving(true)
    try {
      const priceText = (editForm.purchase_price || '').trim()
      const payload: Record<string, unknown> = { ...editForm }
      payload.purchase_price = priceText === '' ? null : Number(priceText)
      if (priceText !== '' && (Number.isNaN(payload.purchase_price) || (payload.purchase_price as number) < 0)) {
        Taro.showToast({ title: '价格填个数字吧', icon: 'none' })
        setSaving(false)
        return
      }
      const updated = await api.patch<ClothingItem>(`/items/${itemId}`, payload)
      setItem(updated)
      setEditing(false)
      Taro.showToast({ title: '保存好了', icon: 'success' })
    } catch (err) {
      console.error('Failed to save:', err)
      Taro.showToast({ title: '没保存上，再试一次？', icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      const res = await Taro.showModal({
        title: '确定要删除吗',
        content: `删除后就找不回这件${TYPE_LABELS[item?.type || ''] || '衣物'}了`,
        confirmText: '删除',
        confirmColor: '#FF4136',
      })
      if (res.confirm) {
        await api.delete(`/items/${itemId}`)
        Taro.showToast({ title: '删除成功', icon: 'success' })
        setTimeout(() => Taro.navigateBack(), 1000)
      }
    } catch (err) {
      console.error('Delete failed:', err)
      Taro.showToast({ title: '删除没成功', icon: 'none' })
    }
  }

  const handleLogWear = async () => {
    if (loggingWear) return
    setLoggingWear(true)
    try {
      await api.post(`/items/${itemId}/wear`, { occasion: 'casual' })
      Taro.showToast({ title: '已记录今天穿了这件', icon: 'success' })
      loadItemDetail()
    } catch (err) {
      console.error('Log wear failed:', err)
      Taro.showToast({ title: '记录没成功', icon: 'none' })
    } finally {
      setLoggingWear(false)
    }
  }

  const handleLogWash = async () => {
    if (loggingWash) return
    setLoggingWash(true)
    try {
      await api.post(`/items/${itemId}/wash`, { method: 'machine' })
      Taro.showToast({ title: '已记录清洗', icon: 'success' })
      loadItemDetail()
    } catch (err) {
      console.error('Log wash failed:', err)
      Taro.showToast({ title: '记录没成功', icon: 'none' })
    } finally {
      setLoggingWash(false)
    }
  }

  const handleArchive = async () => {
    if (archiving) return
    try {
      const res = await Taro.showModal({
        title: '归档这件衣物',
        content: '归档后不会出现在衣橱列表，但随时可以恢复',
        confirmText: '归档',
      })
      if (!res.confirm) return
      setArchiving(true)
      await api.post(`/items/${itemId}/archive`, { reason: 'user_archived' })
      Taro.showToast({ title: '已归档', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 1000)
    } catch (err) {
      console.error('Archive failed:', err)
      Taro.showToast({ title: '归档没成功', icon: 'none' })
    } finally {
      setArchiving(false)
    }
  }

  const handleAnalyze = async () => {
    if (analyzing) return
    setAnalyzing(true)
    try {
      await api.post(`/items/${itemId}/analyze`)
      Taro.showToast({ title: 'AI 重新分析中，稍后刷新看看', icon: 'none', duration: 2000 })
    } catch (err) {
      console.error('Analyze failed:', err)
      Taro.showToast({ title: '分析请求没成功', icon: 'none' })
    } finally {
      setAnalyzing(false)
    }
  }

  // Helper: build tags array from item data
  const buildTags = () => {
    if (!item) return []
    const tags: string[] = []
    if (item.formality) tags.push(FORMALITY_LABELS_CN[item.formality] || item.formality)
    if (item.fit) tags.push(FIT_LABELS_CN[item.fit] || item.fit)
    if (item.pattern) tags.push(PATTERN_LABELS_CN[item.pattern] || item.pattern)
    if (item.style?.length) {
      item.style.forEach(s => {
        const label = STYLE_LABELS_CN[s] || s
        if (!tags.includes(label)) tags.push(label)
      })
    }
    if (item.season?.length) {
      item.season.forEach(s => {
        const label = SEASON_LABELS_CN[s] || s
        if (!tags.includes(label)) tags.push(label)
      })
    }
    return tags
  }

  const handleTryOnThis = useCallback(() => {
    if (item) {
      setTryOnVisible(true)
    }
  }, [item])

  const handleSupplementPhoto = useCallback(async () => {
    try {
      const res = await Taro.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['camera', 'album'],
        sizeType: ['compressed'],
      })
      if (!res.tempFiles?.length) return

      const filePath = res.tempFiles[0].tempFilePath
      Taro.showLoading({ title: '上传中...' })

      const result: any = await uploadFile('/items/parse', filePath, 'image', { scene_type: 'avatar' }, 120000)
      Taro.hideLoading()

      if (result.items && result.items.length > 0) {
        await api.post('/items/from-parse', {
          items: result.items,
          image_path: result.image_path,
          scene_type: 'avatar',
        })
        Taro.showToast({ title: '上身照已上传，可以试穿了！', icon: 'success', duration: 2000 })
      }
    } catch (err) {
      Taro.hideLoading()
      console.error('Supplement photo failed:', err)
      Taro.showToast({ title: '上传失败，再试试', icon: 'none' })
    }
  }, [])

  if (loading) {
    return (
      <View className='detail-page'>
        <View className='detail-loading'>
          <View className='detail-loading-spinner' />
          <Text className='detail-loading-text'>加载中...</Text>
        </View>
      </View>
    )
  }

  if (!item) {
    return (
      <View className='detail-page'>
        <View className='detail-error'>
          <Image src={icons['shirt']} className='detail-error-icon' style={{width: '48rpx', height: '48rpx'}} />
          <Text className='detail-error-text'>衣物不存在</Text>
        </View>
      </View>
    )
  }

  const tags = buildTags()

  return (
    <View className='detail-page'>
      <ScrollView scrollY className='detail-scroll'>
        {/* Hero Image */}
        <View className='detail-hero'>
          {item.image_url ? (
            <CachedImage
              className='detail-hero-image'
              src={resolveImageUrl(item.image_url) || ''}
              mode='aspectFit'
            />
          ) : (
            <View className='detail-hero-placeholder'>
              <Image src={icons['shirt']} className='detail-hero-emoji' style={{width: '48rpx', height: '48rpx'}} />
            </View>
          )}
          {/* Gradient overlay at bottom */}
          <View className='detail-hero-gradient' />
          {/* Wash badge */}
          {item.needs_wash && (
            <View className='detail-wash-badge'>
              <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['shirt']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='detail-wash-badge-text'>待清洗</Text></View>
            </View>
          )}
          {item?.tryon_ready && (
            <View className='detail-tryon-badge'>
              <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['shirt']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='detail-tryon-badge-text'>可试穿</Text></View>
            </View>
          )}
        </View>

        {/* Supplement photo banner — only for flat-lay items */}
        {item && !item.tryon_ready && item.source_scene === 'commodity' && (
          <View className='detail-supplement-banner' onClick={handleSupplementPhoto}>
            <View className='detail-supplement-banner-left'>
              <Image src={icons['camera']} className='detail-supplement-banner-icon' style={{width: '48rpx', height: '48rpx'}} />
              <View className='detail-supplement-banner-text'>
                <Text className='detail-supplement-banner-title'>拍一张上身照，解锁 AI 试穿</Text>
                <Text className='detail-supplement-banner-desc'>让这件衣物也能虚拟试穿</Text>
              </View>
            </View>
            <Text className='detail-supplement-banner-arrow'>›</Text>
          </View>
        )}

        {/* Title & Type */}
        <View className='detail-title-section'>
          <View className='detail-type-badge'>
            <Text className='detail-type-badge-text'>{getTypeLabel(item.type)}</Text>
          </View>
          {item.name && <Text className='detail-name'>{item.name}</Text>}
          {item.brand && <Text className='detail-brand'>{item.brand}</Text>}
        </View>

        {/* Tags */}
        {tags.length > 0 && (
          <View className='detail-tags'>
            {tags.map((tag, idx) => (
              <View key={idx} className='detail-tag'>
                <Text className='detail-tag-text'>{tag}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Description Card */}
        {(item.ai_description || item.description) && (
          <View className='detail-desc-card'>
            <View className='detail-desc-header'>
              <Image src={icons['sparkles']} className='detail-desc-icon' style={{width: '48rpx', height: '48rpx'}} />
              <Text className='detail-desc-label'>衣物简介</Text>
            </View>
            <Text className='detail-desc-text' user-select>{item.ai_description || item.description}</Text>
          </View>
        )}

        {/* Attributes Grid */}
        <View className='detail-attrs'>
          <Text className='detail-section-title'>属性详情</Text>
          <View className='detail-attrs-grid'>
            {item.primary_color && (
              <View className='detail-attr'>
                <Text className='detail-attr-label'>颜色</Text>
                <View className='detail-attr-color'>
                  <View className='detail-attr-color-dot' style={{ backgroundColor: COLOR_MAP[item.primary_color] || '#ccc' }} />
                  <Text className='detail-attr-value'>{COLOR_LABELS_CN[item.primary_color] || item.primary_color}</Text>
                </View>
              </View>
            )}
            {item.material && (
              <View className='detail-attr'>
                <Text className='detail-attr-label'>材质</Text>
                <Text className='detail-attr-value'>{MATERIAL_LABELS_CN[item.material] || item.material}</Text>
              </View>
            )}
            {item.colors?.length > 0 && (
              <View className='detail-attr'>
                <Text className='detail-attr-label'>配色</Text>
                <View className='detail-attr-colors'>
                  {item.colors.map((c, i) => (
                    <View key={i} className='detail-attr-color'>
                      <View className='detail-attr-color-dot' style={{ backgroundColor: COLOR_MAP[c] || '#ccc' }} />
                      <Text className='detail-attr-value'>{COLOR_LABELS_CN[c] || c}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
            {item.formality && (
              <View className='detail-attr'>
                <Text className='detail-attr-label'>正式度</Text>
                <Text className='detail-attr-value'>{FORMALITY_LABELS_CN[item.formality] || item.formality}</Text>
              </View>
            )}
            {item.fit && (
              <View className='detail-attr'>
                <Text className='detail-attr-label'>版型</Text>
                <Text className='detail-attr-value'>{FIT_LABELS_CN[item.fit] || item.fit}</Text>
              </View>
            )}
            {item.pattern && (
              <View className='detail-attr'>
                <Text className='detail-attr-label'>图案</Text>
                <Text className='detail-attr-value'>{PATTERN_LABELS_CN[item.pattern] || item.pattern}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Wear Stats */}
        {wearStats && (
          <View className='detail-stats'>
            <Text className='detail-section-title'>穿着统计</Text>
            <View className='detail-stats-grid'>
              <View className='detail-stat-card'>
                <Text className='detail-stat-number'>{wearStats.total_wears || 0}</Text>
                <Text className='detail-stat-label'>总穿着</Text>
              </View>
              <View className='detail-stat-card'>
                <Text className='detail-stat-number'>{wearStats.wears_this_month || 0}</Text>
                <Text className='detail-stat-label'>本月</Text>
              </View>
              <View className='detail-stat-card'>
                <Text className='detail-stat-number'>{wearStats.wears_this_week || 0}</Text>
                <Text className='detail-stat-label'>本周</Text>
              </View>
              <View className='detail-stat-card'>
                <Text className='detail-stat-number detail-stat-number--small'>
                  {item.last_worn_at
                    ? (() => { const d = new Date(item.last_worn_at); return `${d.getMonth() + 1}月${d.getDate()}日` })()
                    : '—'}
                </Text>
                <Text className='detail-stat-label'>最近穿着</Text>
              </View>
            </View>
            {/* 单次穿着成本（CPW）：填了购买价格才有意义 */}
            {purchasePrice != null ? (
              <View className='detail-cpw' onClick={() => setEditing(true)}>
                <Text className='detail-cpw-text'>
                  购买价 ¥{purchasePrice} · 已穿 {wearStats.total_wears || 0} 次 · 单次穿着成本 ¥
                  {(purchasePrice / Math.max(wearStats.total_wears || 0, 1)).toFixed(1)}
                </Text>
              </View>
            ) : (
              <View className='detail-cpw' onClick={() => setEditing(true)}>
                <Text className='detail-cpw-hint'>填上购买价格，就能看到「单次穿着成本」›</Text>
              </View>
            )}
          </View>
        )}

        {/* Wear History */}
        {wearHistory.length > 0 && (
          <View className='detail-history'>
            <Text className='detail-section-title'>穿着历史</Text>
            {wearHistory.map((entry) => (
              <View key={entry.id} className='detail-history-item'>
                <View className='detail-history-date'>
                  <Text className='detail-history-date-text'>{entry.worn_at}</Text>
                </View>
                <View className='detail-history-info'>
                  {entry.occasion && (
                    <View className='detail-history-occasion'>
                      <Text className='detail-history-occasion-text'>{entry.occasion}</Text>
                    </View>
                  )}
                  {entry.outfit && (
                    <View className='detail-history-outfit'>
                      {(entry.outfit.items || []).map((outfitItem, idx) => (
                        <Text key={idx} className='detail-history-outfit-tag'>
                          {TYPE_LABELS[outfitItem.type] || outfitItem.type}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Empty Wear History */}
        {!loading && wearHistory.length === 0 && (
          <View className='detail-history-empty'>
            <Text className='detail-history-empty-text'>还没穿过这件哦</Text>
          </View>
        )}

        {/* Edit Form */}
        {editing && (
          <View className='detail-edit'>
            <Text className='detail-section-title'>编辑衣物信息</Text>

            <View className='detail-edit-field'>
              <Text className='detail-edit-label'>类型</Text>
              <View className='detail-edit-type-grid'>
                {Object.entries(TYPE_LABELS).slice(0, 12).map(([key, label]) => (
                  <View
                    key={key}
                    className={`detail-edit-type-option ${editForm.type === key ? 'detail-edit-type-option--active' : ''}`}
                    onClick={() => setEditForm({ ...editForm, type: key })}
                  >
                    <Text className='detail-edit-type-text'>{label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View className='detail-edit-field'>
              <Text className='detail-edit-label'>名称</Text>
              <input
                className='detail-edit-input'
                value={editForm.name}
                placeholder='给衣物起个名字'
                onInput={(e: any) => setEditForm({ ...editForm, name: e.detail.value })}
              />
            </View>

            <View className='detail-edit-field'>
              <Text className='detail-edit-label'>主色</Text>
              <View className='detail-edit-color-grid'>
                {Object.entries(COLOR_MAP).slice(0, 14).map(([name, color]) => (
                  <View
                    key={name}
                    className={`detail-edit-color-option ${editForm.primary_color === name ? 'detail-edit-color-option--active' : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setEditForm({ ...editForm, primary_color: name })}
                  />
                ))}
              </View>
            </View>

            <View className='detail-edit-field'>
              <Text className='detail-edit-label'>材质</Text>
              <input
                className='detail-edit-input'
                value={editForm.material}
                placeholder='如：棉、丝绸、牛仔'
                onInput={(e: any) => setEditForm({ ...editForm, material: e.detail.value })}
              />
            </View>

            <View className='detail-edit-field'>
              <Text className='detail-edit-label'>品牌</Text>
              <input
                className='detail-edit-input'
                value={editForm.brand}
                placeholder='品牌名称'
                onInput={(e: any) => setEditForm({ ...editForm, brand: e.detail.value })}
              />
            </View>

            <View className='detail-edit-field'>
              <Text className='detail-edit-label'>购买价格</Text>
              <input
                className='detail-edit-input'
                type='digit'
                value={editForm.purchase_price}
                placeholder='如：299（用于算单次穿着成本）'
                onInput={(e: any) => setEditForm({ ...editForm, purchase_price: e.detail.value })}
              />
            </View>

            <View className='detail-edit-field'>
              <Text className='detail-edit-label'>描述</Text>
              <textarea
                className='detail-edit-textarea'
                value={editForm.description}
                placeholder='添加描述...'
                onInput={(e: any) => setEditForm({ ...editForm, description: e.detail.value })}
              />
            </View>

            <View className='detail-edit-save-btn' onClick={handleSaveEdit}>
              <Text className='detail-edit-save-text'>{saving ? '保存中...' : '保存修改'}</Text>
            </View>
          </View>
        )}

        {/* Action Bar */}
        <View className='detail-actions'>
          <View className='detail-action-btn' onClick={handleLogWear}>
            <Image src={icons['shirt']} className='detail-action-icon' style={{width: '48rpx', height: '48rpx'}} />
            <Text className='detail-action-text'>{loggingWear ? '记录中' : '今天穿了'}</Text>
          </View>
          <View className='detail-action-btn' onClick={handleLogWash}>
            <Image src={icons['shirt']} className='detail-action-icon' style={{width: '48rpx', height: '48rpx'}} />
            <Text className='detail-action-text'>{loggingWash ? '记录中' : '洗了'}</Text>
          </View>
          <View className='detail-action-btn' onClick={handleAnalyze}>
            <Image src={icons['bot']} className='detail-action-icon' style={{width: '48rpx', height: '48rpx'}} />
            <Text className='detail-action-text'>{analyzing ? '分析中' : 'AI分析'}</Text>
          </View>
          {item?.tryon_ready && (
            <View className='detail-action-btn' onClick={handleTryOnThis}>
              <Image src={icons['shirt']} className='detail-action-icon' style={{width: '48rpx', height: '48rpx'}} />
              <Text className='detail-action-text'>试穿</Text>
            </View>
          )}
          <View className='detail-action-btn' onClick={() => {
            if (item) {
              Taro.setStorageSync('suggest_item_id', item.id)
              Taro.switchTab({ url: '/pages/suggest/index' })
            }
          }}>
            <Image src={icons['sparkles']} className='detail-action-icon' style={{width: '48rpx', height: '48rpx'}} />
            <Text className='detail-action-text'>搭配推荐</Text>
          </View>
          <View className='detail-action-btn' onClick={() => setEditing(!editing)}>
            <Image src={icons['pencil']} className='detail-action-icon' style={{width: '40rpx', height: '40rpx'}} />
            <Text className='detail-action-text'>{editing ? '取消' : '编辑'}</Text>
          </View>
        </View>
        <View className='detail-actions detail-actions--secondary'>
          <View className={`detail-action-btn detail-action-btn--muted ${archiving ? 'detail-action-btn--disabled' : ''}`} onClick={handleArchive}>
            <Image src={icons['package']} className='detail-action-icon' style={{width: '48rpx', height: '48rpx'}} />
            <Text className='detail-action-text'>{archiving ? '归档中' : '归档'}</Text>
          </View>
          <View className='detail-action-btn detail-action-btn--danger' onClick={handleDelete}>
            <Image src={icons['trash-2']} className='detail-action-icon' style={{width: '40rpx', height: '40rpx'}} />
            <Text className='detail-action-text'>删除</Text>
          </View>
        </View>

        <View className='detail-bottom-spacer' />
      </ScrollView>

      {/* Virtual Try-On Modal */}
      {item && (
        <VirtualTryOnModal
          visible={tryOnVisible}
          garmentItemIds={[item.id]}
          garmentNames={[item.name || getTypeLabel(item.type)]}
          onClose={() => setTryOnVisible(false)}
        />
      )}
    </View>
  )
}
