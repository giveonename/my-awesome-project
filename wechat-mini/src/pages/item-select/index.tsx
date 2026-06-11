import { View, Text, ScrollView, Image} from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState, useMemo, useCallback } from 'react'
import { api, resolveImageUrl } from '../../utils/api'
import { getItemDisplayName } from '../../constants'
import CachedImage from '../../components/CachedImage'
import './index.scss'
import { icons } from '../../constants/icons'

// ===== Types =====

interface WardrobeItem {
  id: string
  name?: string
  type: string
  primary_color?: string
  thumbnail_url?: string
  image_url?: string
}

// ===== Categories =====

const CATEGORIES = [
  { key: 'all', label: '全部' },
  { key: 'top', label: '上衣' },
  { key: 'bottom', label: '裤子' },
  { key: 'skirt', label: '半身裙' },
  { key: 'dress', label: '连体装' },
  { key: 'shoes', label: '鞋' },
  { key: 'bag', label: '包' },
  { key: 'accessories', label: '配饰' },
]

const CATEGORY_MAP: Record<string, string[]> = {
  top: ['tshirt', 'shirt', 'blouse', 'sweater', 'hoodie', 'jacket', 'coat'],
  bottom: ['pants', 'jeans', 'shorts'],
  skirt: ['skirt'],
  dress: ['dress'],
  shoes: ['shoes', 'sneakers', 'boots', 'sandals'],
  bag: ['bag'],
  accessories: ['hat', 'scarf', 'belt', 'watch', 'jewelry', 'sunglasses'],
}

const TYPE_ICONS: Record<string, string> = {
  tshirt: icons['shirt'], shirt: icons['shirt'], blouse: icons['shirt'], sweater: icons['shirt'], hoodie: icons['shirt'],
  jacket: icons['shirt'], coat: icons['shirt'], vest: icons['shirt'], pants: icons['shirt'], jeans: icons['shirt'],
  shorts: icons['shirt'], skirt: icons['shirt'], dress: icons['shirt'], shoes: icons['shirt'], sneakers: icons['shirt'],
  boots: icons['shirt'], sandals: icons['shirt'], bag: icons['briefcase'], hat: icons['crown'], scarf: icons['shirt'],
  belt: icons['shirt'], watch: '⌚', sunglasses: icons['sun'], jewelry: icons['gem'],
}

// ===== Component =====

export default function ItemSelectPage() {
  const [activeCategory, setActiveCategory] = useState('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [items, setItems] = useState<WardrobeItem[]>([])
  const [loading, setLoading] = useState(true)

  useDidShow(() => {
    loadItems()
  })

  const loadItems = async () => {
    setLoading(true)
    try {
      const data = await api.get<{ items: WardrobeItem[] }>('/items', {
        page: '1',
        page_size: '100',
      })
      setItems(data.items || [])
    } catch (err) {
      console.error('Load items failed:', err)
      Taro.showToast({ title: '衣物加载失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  const filteredItems = useMemo(() => {
    if (activeCategory === 'all') return items
    const types = CATEGORY_MAP[activeCategory] || []
    return items.filter(item => types.includes(item.type))
  }, [activeCategory, items])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleGenerate = useCallback(async () => {
    if (selectedIds.size === 0) return

    Taro.showLoading({ title: '魔搭幻穿正在搭配...' })

    try {
      const ids = Array.from(selectedIds)
      const result = await api.post<{ id: string }>('/outfits/suggest', {
        include_items: ids,
        occasion: 'casual',
      })

      Taro.hideLoading()
      Taro.navigateTo({ url: `/pages/outfit-detail/index?id=${result.id}` })
    } catch (err) {
      Taro.hideLoading()
      console.error('Generate outfit failed:', err)
      Taro.showToast({ title: '搭配没成功，再试一次？', icon: 'none' })
    }
  }, [selectedIds])

  const selectedCount = selectedIds.size

  return (
    <View className='is-page'>

      {/* ===== Category Tabs ===== */}
      <ScrollView scrollX className='is-tabs-scroll'>
        <View className='is-tabs'>
          {CATEGORIES.map(cat => (
            <View
              key={cat.key}
              className={`is-tab ${activeCategory === cat.key ? 'is-tab--active' : ''}`}
              onClick={() => setActiveCategory(cat.key)}
            >
              <Text className='is-tab-text'>{cat.label}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* ===== Item Grid ===== */}
      <ScrollView scrollY className='is-scroll'>
        {/* 骨架屏 */}
        {loading && (
          <View className='is-grid'>
            {[1,2,3,4,5,6].map(i => (
              <View key={i} className='is-skel'>
                <View className='is-skel-img' />
                <View className='is-skel-text' />
              </View>
            ))}
          </View>
        )}

        {/* 空状态 */}
        {!loading && filteredItems.length === 0 && (
          <View className='is-empty'>
            <Image src={icons['folder']} className='is-empty-icon' style={{width: '64rpx', height: '64rpx'}} />
            <Text className='is-empty-text'>这里还是空的</Text>
          </View>
        )}

        {/* 真实数据网格 */}
        {!loading && filteredItems.length > 0 && (
          <View className='is-grid'>
            {filteredItems.map((item, idx) => {
              const isSelected = selectedIds.has(item.id)
              return (
                <View
                  key={item.id}
                  className={`is-card ${isSelected ? 'is-card--selected' : ''}`}
                  style={{ animationDelay: `${idx * 40}ms` }}
                  onClick={() => toggleSelect(item.id)}
                >
                  {/* 图片区域 */}
                  <View className='is-card-img'>
                    {item.thumbnail_url ? (
                      <CachedImage
                        className='is-card-img-real'
                        src={resolveImageUrl(item.thumbnail_url) || ''}
                        mode='aspectFill'
                      />
                    ) : (
                      <Image src={TYPE_ICONS[item.type] || icons['shirt']} style={{width: '48rpx', height: '48rpx'}} />
                    )}
                    {/* 选中指示器 */}
                    <View className={`is-check ${isSelected ? 'is-check--on' : ''}`}>
                      {isSelected && <Image src={icons['check']} className='is-check-icon' style={{width: '48rpx', height: '48rpx'}} />}
                    </View>
                  </View>
                  {/* 名称 */}
                  <Text className='is-card-name'>{getItemDisplayName(item.name, item.type)}</Text>
                </View>
              )
            })}
          </View>
        )}

        {/* Bottom Padding */}
        <View style={{ height: '180rpx' }} />
      </ScrollView>

      {/* ===== Bottom Action Bar ===== */}
      <View className='is-bar'>
        <View className='is-bar-info'>
          <Text className='is-bar-count'>
            {selectedCount > 0 ? `已选 ${selectedCount} 件` : '选择单品开始搭配'}
          </Text>
        </View>
        <View
          className={`is-bar-btn ${selectedCount > 0 ? '' : 'is-bar-btn--disabled'}`}
          onClick={handleGenerate}
        >
          <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['wand-sparkles']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='is-bar-btn-text'>让 AI 帮我搭配</Text></View>
        </View>
      </View>
    </View>
  )
}
