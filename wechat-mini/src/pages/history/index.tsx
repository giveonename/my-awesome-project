import { View, Text, ScrollView, Image} from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState, useEffect, useRef, useMemo } from 'react'
import { api, resolveImageUrl } from '../../utils/api'
import CachedImage from '../../components/CachedImage'
import { TYPE_LABELS } from '../../constants'
import './index.scss'
import { icons } from '../../constants/icons'

interface OutfitItem {
  id: string
  type: string
  primary_color?: string
  name?: string
  thumbnail_url?: string
}

interface OutfitRecord {
  id: string
  name?: string
  items: OutfitItem[]
  occasion?: string
  rating?: number
  scheduled_for?: string
  created_at: string
  reasoning?: string
}

interface OutfitListResponse {
  outfits: OutfitRecord[]
  total: number
}

export default function HistoryPage() {
  const [outfits, setOutfits] = useState<OutfitRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const isFirstShow = useRef(true)

  useDidShow(() => {
    if (isFirstShow.current) {
      isFirstShow.current = false
      return
    }
    loadHistory(currentMonth)
  })

  useEffect(() => {
    loadHistory(currentMonth)
  }, [currentMonth])

  const loadHistory = async (month: string) => {
    setLoading(true)
    try {
      const [year, m] = month.split('-').map(Number)
      const dateFrom = `${year}-${String(m).padStart(2, '0')}-01`
      const lastDay = new Date(year, m, 0).getDate()
      const dateTo = `${year}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

      const data = await api.get<OutfitListResponse>('/outfits', {
        date_from: dateFrom,
        date_to: dateTo,
        page: '1',
        page_size: '50',
      })
      setOutfits(data.outfits || [])
    } catch (err) {
      console.error('Failed to load history:', err)
    } finally {
      setLoading(false)
    }
  }

  const getDaysInMonth = (month: string) => {
    const [year, m] = month.split('-').map(Number)
    return new Date(year, m, 0).getDate()
  }

  const getFirstDayOfMonth = (month: string) => {
    const [year, m] = month.split('-').map(Number)
    return new Date(year, m - 1, 1).getDay()
  }

  const getOutfitsForDate = (dateStr: string) => {
    return outfits.filter(o => o.scheduled_for === dateStr)
  }

  const getMonthStats = () => {
    const totalDays = outfits.length
    const uniqueDays = new Set(outfits.map(o => o.scheduled_for)).size
    const totalItems = outfits.reduce((sum, o) => sum + o.items.length, 0)
    const occasions = outfits.reduce((acc, o) => {
      if (o.occasion) acc[o.occasion] = (acc[o.occasion] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    const topOccasion = Object.entries(occasions).sort((a, b) => b[1] - a[1])[0]
    return { totalDays, uniqueDays, totalItems, topOccasion }
  }

  const renderCalendar = () => {
    const days = getDaysInMonth(currentMonth)
    const firstDay = getFirstDayOfMonth(currentMonth)
    const todayStr = new Date().toISOString().split('T')[0]
    const cells: JSX.Element[] = []

    for (let i = 0; i < firstDay; i++) {
      cells.push(<View key={`empty-${i}`} className='calendar-cell calendar-cell--empty' />)
    }

    for (let d = 1; d <= days; d++) {
      const dateStr = `${currentMonth}-${String(d).padStart(2, '0')}`
      const dayOutfits = getOutfitsForDate(dateStr)
      const hasOutfit = dayOutfits.length > 0
      const isToday = dateStr === todayStr
      const isSelected = dateStr === selectedDate

      // Get first outfit's first item thumbnail for the calendar
      const previewItem = dayOutfits[0]?.items?.[0]

      cells.push(
        <View
          key={d}
          className={`calendar-cell ${isToday ? 'calendar-cell--today' : ''} ${hasOutfit ? 'calendar-cell--has-outfit' : ''} ${isSelected ? 'calendar-cell--selected' : ''}`}
          onClick={() => hasOutfit && setSelectedDate(isSelected ? null : dateStr)}
        >
          <Text className='calendar-day'>{d}</Text>
              {hasOutfit && previewItem?.thumbnail_url ? (
            <CachedImage
              className='calendar-preview'
              src={resolveImageUrl(previewItem.thumbnail_url) || ''}
              mode='aspectFill'
            />
          ) : hasOutfit ? (
            <View className='calendar-dot' />
          ) : null}
        </View>
      )
    }

    return cells
  }

  const navigateMonth = (delta: number) => {
    const [year, m] = currentMonth.split('-').map(Number)
    const date = new Date(year, m - 1 + delta, 1)
    const newMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    setCurrentMonth(newMonth)
    setSelectedDate(null)
  }

  const formatMonthTitle = (month: string) => {
    const [year, m] = month.split('-')
    return `${year}年${parseInt(m)}月`
  }

  const renderStars = (rating?: number) => {
    if (!rating) return null
    return '⭐'.repeat(Math.min(rating, 5))
  }

  // Filter outfits for selected date or show all
  const displayOutfits = useMemo(
    () => selectedDate ? outfits.filter(o => o.scheduled_for === selectedDate) : outfits,
    [selectedDate, outfits]
  )

  const stats = useMemo(() => getMonthStats(), [outfits])

  return (
    <ScrollView scrollY className='history-page'>
      {/* Calendar */}
      <View className='calendar-card'>
        <View className='calendar-header'>
          <View className='calendar-nav' onClick={() => navigateMonth(-1)}>
            <Text className='calendar-nav-text'>◀</Text>
          </View>
          <Text className='calendar-month'>{formatMonthTitle(currentMonth)}</Text>
          <View className='calendar-nav' onClick={() => navigateMonth(1)}>
            <Text className='calendar-nav-text'>▶</Text>
          </View>
        </View>

        <View className='calendar-weekdays'>
          {['日', '一', '二', '三', '四', '五', '六'].map(d => (
            <Text key={d} className='calendar-weekday'>{d}</Text>
          ))}
        </View>

        <View className='calendar-grid'>
          {renderCalendar()}
        </View>
      </View>

      {/* Month Stats */}
      {!loading && outfits.length > 0 && (
        <View className='stats-card'>
          <View className='stats-row'>
            <View className='stat-item'>
              <Text className='stat-value'>{stats.uniqueDays}</Text>
              <Text className='stat-label'>穿搭天数</Text>
            </View>
            <View className='stat-item'>
              <Text className='stat-value'>{stats.totalDays}</Text>
              <Text className='stat-label'>总记录</Text>
            </View>
            <View className='stat-item'>
              <Text className='stat-value'>{stats.totalItems}</Text>
              <Text className='stat-label'>使用衣物</Text>
            </View>
            <View className='stat-item'>
              <Text className='stat-value'>{stats.topOccasion ? stats.topOccasion[0] : '-'}</Text>
              <Text className='stat-label'>最常场合</Text>
            </View>
          </View>
        </View>
      )}

      {/* Outfit List */}
      <View className='history-list'>
        <View className='history-list-header'>
          <Text className='history-title'>
            {selectedDate ? `${selectedDate} 穿搭` : '本月穿搭记录'}
          </Text>
          {selectedDate && (
            <Text className='history-clear' onClick={() => setSelectedDate(null)}>
              查看全部
            </Text>
          )}
        </View>

        {loading ? (
          <View className='history-loading'>
            <Text className='history-loading-text'>加载中...</Text>
          </View>
        ) : displayOutfits.length > 0 ? (
          displayOutfits.map(outfit => (
            <View key={outfit.id} className='history-card'>
              <View className='history-card-header'>
                <Text className='history-date'>
                  {outfit.scheduled_for || '未知日期'}
                </Text>
                {outfit.occasion && (
                  <View className='history-occasion-badge'>
                    <Text className='history-occasion-text'>{outfit.occasion}</Text>
                  </View>
                )}
                {outfit.rating && (
                  <Text className='history-rating'>{renderStars(outfit.rating)}</Text>
                )}
              </View>

              {/* Item thumbnails grid */}
              <View className='history-items-grid'>
                {(outfit.items || []).map((item, idx) => (
                  <View key={item.id || idx} className='history-item-card'>
                    <View className='history-item-img'>
                      {item.thumbnail_url ? (
                        <CachedImage
                          className='history-item-thumb'
                          src={resolveImageUrl(item.thumbnail_url) || ''}
                          mode='aspectFill'
                        />
                      ) : (
                        <View className='history-item-placeholder'>
                          <Image src={icons['shirt']} className='history-item-emoji' style={{width: '48rpx', height: '48rpx'}} />
                        </View>
                      )}
                    </View>
                    <Text className='history-item-label'>
                      {TYPE_LABELS[item.type] || item.type}
                    </Text>
                    {item.primary_color && (
                      <Text className='history-item-color'>{item.primary_color}</Text>
                    )}
                  </View>
                ))}
              </View>

              {/* Reasoning */}
              {outfit.reasoning && (
                <Text className='history-reasoning'>{outfit.reasoning}</Text>
              )}
            </View>
          ))
        ) : (
          <View className='history-empty'>
            <Image src={icons['calendar']} className='history-empty-icon' style={{width: '48rpx', height: '48rpx'}} />
            <Text className='history-empty-text'>
              {selectedDate ? '这一天还没有穿搭记录' : '本月还没有穿搭记录'}
            </Text>
            <Text className='history-empty-hint'>去推荐页看看今日穿搭吧</Text>
          </View>
        )}
      </View>

      <View className='history-bottom-spacer' />
    </ScrollView>
  )
}