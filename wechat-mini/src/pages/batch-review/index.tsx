import { View, Text, Image } from '@tarojs/components'
import Taro, { useRouter, useDidShow } from '@tarojs/taro'
import { useState, useCallback } from 'react'
import { api, resolveImageUrl } from '../../utils/api'
import CachedImage from '../../components/CachedImage'
import { icons } from '../../constants/icons'
import './index.scss'

interface BatchItem {
  id: string
  name: string
  type: string
  primary_color: string
  thumbnail_path: string | null
  status: string
  scene_type: string
}

interface BatchStatus {
  batch_id: string
  status: string
  total: number
  completed: number
  failed: number
  items: BatchItem[]
}

export default function BatchReviewPage() {
  const router = useRouter()
  const batchId = router.params.batch_id || ''

  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const loadStatus = useCallback(async () => {
    if (!batchId) return
    try {
      const data = await api.get<BatchStatus>(`/items/batch-status/${batchId}`)
      setBatchStatus(data)
      // Auto-select all completed items
      if (data.items?.length) {
        setSelectedIds(new Set(data.items.map(i => i.id)))
      }
    } catch (err) {
      console.error('Load batch status failed:', err)
    } finally {
      setLoading(false)
    }
  }, [batchId])

  useDidShow(() => {
    loadStatus()
  })

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (!batchStatus?.items?.length) return
    setSelectedIds(prev => {
      if (prev.size === batchStatus.items.length) return new Set()
      return new Set(batchStatus.items.map(i => i.id))
    })
  }, [batchStatus])

  const handleSave = useCallback(async () => {
    if (selectedIds.size === 0) {
      Taro.showToast({ title: '请至少选择一件衣物', icon: 'none' })
      return
    }
    setSaving(true)
    try {
      const count = selectedIds.size
      Taro.showToast({ title: `已保存 ${count} 件衣物`, icon: 'success' })
      setTimeout(() => {
        Taro.switchTab({ url: '/pages/wardrobe/index' })
      }, 1500)
    } catch (err) {
      console.error('Save failed:', err)
      Taro.showToast({ title: '保存失败，请重试', icon: 'none' })
    } finally {
      setSaving(false)
    }
  }, [selectedIds])

  if (loading) {
    return (
      <View className='batch-review-page'>
        <View className='batch-review-loading'>
          <View className='skel-card skel-card--medium' />
          <View className='skel-card skel-card--medium' />
        </View>
      </View>
    )
  }

  if (!batchStatus) {
    return (
      <View className='batch-review-page'>
        <View className='batch-review-empty'>
          <Text className='batch-review-empty-text'>未找到批量任务</Text>
        </View>
      </View>
    )
  }

  return (
    <View className='batch-review-page'>
      {/* Header */}
      <View className='batch-review-header'>
        <Text className='batch-review-title'>批量识别结果</Text>
        <Text className='batch-review-subtitle'>
          {batchStatus.status === 'completed'
            ? `全部 ${batchStatus.completed} 件识别完成`
            : `已完成 ${batchStatus.completed}/${batchStatus.total} 件`}
        </Text>
      </View>

      {/* Select All */}
      <View className='batch-review-select-all' onClick={toggleSelectAll}>
        <View className={`batch-review-checkbox ${selectedIds.size === batchStatus.items.length ? 'batch-review-checkbox--checked' : ''}`}>
          {selectedIds.size === batchStatus.items.length && (
            <Text className='batch-review-checkbox-text'>{'\u2713'}</Text>
          )}
        </View>
        <Text className='batch-review-select-all-text'>全选 ({selectedIds.size}/{batchStatus.items.length})</Text>
      </View>

      {/* Items Grid */}
      <View className='batch-review-grid'>
        {batchStatus.items.map((item) => (
          <View
            key={item.id}
            className={`batch-review-card ${selectedIds.has(item.id) ? 'batch-review-card--selected' : ''}`}
            onClick={() => toggleSelect(item.id)}
          >
            <View className='batch-review-card-img-wrap'>
              {item.thumbnail_path ? (
                <CachedImage
                  className='batch-review-card-img'
                  src={resolveImageUrl(item.thumbnail_path) || ''}
                  mode='aspectFill'
                />
              ) : (
                <View className='batch-review-card-placeholder'>
                  <Text>{'\uD83D\uDC55'}</Text>
                </View>
              )}
              <View className={`batch-review-card-check ${selectedIds.has(item.id) ? 'batch-review-card-check--active' : ''}`}>
                {selectedIds.has(item.id) && <Text className='batch-review-card-check-text'>{'\u2713'}</Text>}
              </View>
            </View>
            <View className='batch-review-card-info'>
              <Text className='batch-review-card-name'>{item.name}</Text>
              {item.primary_color && (
                <Text className='batch-review-card-color'>{item.primary_color}</Text>
              )}
            </View>
          </View>
        ))}
      </View>

      {/* Save Button */}
      <View className='batch-review-footer'>
        <View
          className={`batch-review-save-btn ${selectedIds.size === 0 ? 'batch-review-save-btn--disabled' : ''}`}
          onClick={handleSave}
        >
          <Text className='batch-review-save-btn-text'>
            {saving ? '保存中...' : `加入衣橱 (${selectedIds.size})`}
          </Text>
        </View>
      </View>
    </View>
  )
}
