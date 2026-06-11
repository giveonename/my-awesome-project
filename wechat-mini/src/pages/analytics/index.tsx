import { View, Text, ScrollView, Image} from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState, useEffect, useRef, useMemo } from 'react'
import { api, resolveImageUrl } from '../../utils/api'
import { TYPE_LABELS, COLOR_LABELS_CN, getTypeLabel, sanitizeDisplay } from '../../constants'
import CachedImage from '../../components/CachedImage'
import './index.scss'
import { icons } from '../../constants/icons'

// ===== Types =====

interface ColorDistribution {
  color: string
  count: number
  percentage: number
}

interface TypeDistribution {
  type: string
  count: number
  percentage: number
}

interface WearStats {
  id: string
  name: string | null
  type: string
  primary_color: string | null
  thumbnail_url: string | null
  wear_count: number
  last_worn_at: string | null
}

interface WardrobeStats {
  total_items: number
  total_outfits: number
  total_wears: number
  outfits_this_month: number
  acceptance_rate: number | null
}

interface ActivityDay {
  date: string
  count: number
}

interface AnalyticsData {
  wardrobe: WardrobeStats
  color_distribution: ColorDistribution[]
  type_distribution: TypeDistribution[]
  most_worn: WearStats[]
  never_worn: WearStats[]
  activity: ActivityDay[]
  insights: string[]
}

interface LearningProfile {
  has_learning_data: boolean
  feedback_count: number
  outfits_rated: number
  overall_acceptance_rate: number | null
  average_rating: number | null
}

interface LearnedInsight {
  id: string
  category: string
  title: string
  description: string
  confidence: number
}

interface LearningData {
  profile: LearningProfile
  insights: LearnedInsight[]
}

// ===== Color Palette =====

const CHART_COLORS = [
  '#7C6FEB', '#9B8FFF', '#5AC8FA', '#34C759', '#FF9500',
  '#FF3B30', '#FF6B8A', '#30D5C8', '#BF5AF2', '#FFD60A',
]

// ===== Hooks =====

function useCountUp(target: number, duration: number = 800): number {
  const [value, setValue] = useState(0)
  const frameRef = useRef(0)

  useEffect(() => {
    if (target <= 0) { setValue(0); return }
    const start = performance.now()
    const animate = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(eased * target))
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate)
      }
    }
    frameRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frameRef.current)
  }, [target, duration])

  return value
}

// ===== Sub-Components =====

function CountUpCard({ label, value, icon, delay }: { label: string; value: number; icon: string; delay: number }) {
  const displayValue = useCountUp(value, 1000)
  return (
    <View className='ac-overview-card animate-fade-in-up' style={{ animationDelay: `${delay}ms` }}>
      <Image src={{icon}} className='ac-overview-icon' style={{width: '48rpx', height: '48rpx'}} />
      <Text className='ac-overview-value'>{displayValue}</Text>
      <Text className='ac-overview-label'>{label}</Text>
    </View>
  )
}

function StackedBar({ data }: { data: TypeDistribution[] }) {
  const total = data.reduce((s, d) => s + d.count, 0)
  if (total === 0) return null

  return (
    <View className='ac-stacked'>
      <View className='ac-stacked-bar'>
        {data.map((item, idx) => (
          <View
            key={item.type}
            className='ac-stacked-segment'
            style={{
              width: `${(item.count / total) * 100}%`,
              background: CHART_COLORS[idx % CHART_COLORS.length],
            }}
          />
        ))}
      </View>
      <View className='ac-stacked-legend'>
        {data.map((item, idx) => (
          <View key={item.type} className='ac-stacked-legend-item'>
            <View
              className='ac-stacked-legend-dot'
              style={{ background: CHART_COLORS[idx % CHART_COLORS.length] }}
            />
            <Text className='ac-stacked-legend-name'>
              {getTypeLabel(item.type)}
            </Text>
            <Text className='ac-stacked-legend-pct'>
              {Math.round((item.count / total) * 100)}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function ColorPalette({ data }: { data: ColorDistribution[] }) {
  if (data.length === 0) return null
  const maxCount = Math.max(...data.map(d => d.count), 1)

  return (
    <View className='ac-palette'>
      {data.map((item, idx) => {
        const size = 48 + Math.round((item.count / maxCount) * 48) // 48~96rpx
        return (
          <View
            key={item.color}
            className='ac-palette-swatch animate-scale-in'
            style={{ animationDelay: `${idx * 60}ms` }}
          >
            <View
              className='ac-palette-circle'
              style={{
                width: `${size}rpx`,
                height: `${size}rpx`,
                background: item.color,
              }}
            />
            <Text className='ac-palette-name'>
              {COLOR_LABELS_CN[item.color] || item.color}
            </Text>
            <Text className='ac-palette-count'>{item.count}件</Text>
          </View>
        )
      })}
    </View>
  )
}

function Heatmap({ data }: { data: ActivityDay[] }) {
  // Build 7x4 grid (28 days)
  const grid = useMemo(() => {
    const cells: { date: string; count: number; level: number }[] = []
    const today = new Date()

    for (let i = 27; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split('T')[0]
      const dayData = data.find(a => a.date === dateStr)
      const count = dayData?.count || 0
      // level: 0=none, 1=low, 2=medium, 3=high
      let level = 0
      if (count >= 3) level = 3
      else if (count >= 2) level = 2
      else if (count >= 1) level = 1
      cells.push({ date: dateStr, count, level })
    }
    return cells
  }, [data])

  return (
    <View className='ac-heatmap'>
      <View className='ac-heatmap-grid'>
        {grid.map((cell, idx) => (
          <View
            key={cell.date}
            className={`ac-heatmap-cell ac-heatmap-cell--${cell.level}`}
            style={{ animationDelay: `${idx * 15}ms` }}
          />
        ))}
      </View>
      <View className='ac-heatmap-legend'>
        <Text className='ac-heatmap-legend-text'>少</Text>
        {[0, 1, 2, 3].map(l => (
          <View key={l} className={`ac-heatmap-cell ac-heatmap-cell--${l}`} />
        ))}
        <Text className='ac-heatmap-legend-text'>多</Text>
      </View>
    </View>
  )
}

function WearItem({ item, delay }: { item: WearStats; delay: number }) {
  return (
    <View
      className='ac-wear-item animate-fade-in-up'
      style={{ animationDelay: `${delay}ms` }}
      onClick={() => Taro.navigateTo({ url: `/pages/item-detail/index?id=${item.id}` })}
    >
      <View className='ac-wear-img'>
        {item.thumbnail_url ? (
          <CachedImage className='ac-wear-thumb' src={resolveImageUrl(item.thumbnail_url) || ''} mode='aspectFill' />
        ) : (
          <Image src={icons['shirt']} className='ac-wear-emoji' style={{width: '48rpx', height: '48rpx'}} />
        )}
      </View>
      <View className='ac-wear-info'>
        <Text className='ac-wear-type'>{getTypeLabel(item.type)}</Text>
        {sanitizeDisplay(item.name) && <Text className='ac-wear-name'>{sanitizeDisplay(item.name)}</Text>}
      </View>
      <View className='ac-wear-count'>
        <Text className='ac-wear-count-num'>{item.wear_count}</Text>
        <Text className='ac-wear-count-label'>次</Text>
      </View>
    </View>
  )
}

// ===== Main Component =====

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [learning, setLearning] = useState<LearningData | null>(null)
  const [loading, setLoading] = useState(true)

  useDidShow(() => {
    loadAnalytics()
  })

  const loadAnalytics = async () => {
    setLoading(true)
    try {
      const [analyticsRes, learningRes] = await Promise.allSettled([
        api.get<AnalyticsData>('/analytics'),
        api.get<LearningData>('/learning'),
      ])
      if (analyticsRes.status === 'fulfilled') setData(analyticsRes.value)
      if (learningRes.status === 'fulfilled') setLearning(learningRes.value)
    } catch (err) {
      console.error('Failed to load analytics:', err)
      Taro.showToast({ title: '加载出了点问题', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <View className='ac-page'>
        <View className='ac-loading'>
          <View className='ac-loading-glow' />
          <Text className='ac-loading-text'>正在分析你的衣橱...</Text>
        </View>
      </View>
    )
  }

  if (!data) {
    return (
      <View className='ac-page'>
        <View className='ac-empty'>
          <Image src={icons['bar-chart-3']} className='ac-empty-icon' style={{width: '48rpx', height: '48rpx'}} />
          <Text className='ac-empty-title'>还没有统计数据</Text>
          <Text className='ac-empty-desc'>多穿几次衣服，数据就有了</Text>
        </View>
      </View>
    )
  }

  const { wardrobe, color_distribution, type_distribution, most_worn, never_worn, activity, insights } = data

  return (
    <ScrollView scrollY className='ac-page'>

      {/* ===== Overview Cards ===== */}
      <View className='ac-overview'>
        <CountUpCard label='衣物总数' value={wardrobe.total_items} icon={icons['shirt']} delay={0} />
        <CountUpCard label='搭配方案' value={wardrobe.total_outfits} icon={icons['sparkles']} delay={60} />
        <CountUpCard label='穿搭记录' value={wardrobe.total_wears} icon={icons['calendar']} delay={120} />
      </View>

      {/* ===== AI Insights ===== */}
      {insights.length > 0 && (
        <View className='ac-card'>
          <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['lightbulb']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='ac-card-title'>AI 洞察</Text></View>
          {insights.map((insight, idx) => (
            <View key={idx} className='ac-insight' style={{ animationDelay: `${idx * 60}ms` }}>
              <Text className='ac-insight-text'>{insight}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ===== Type Distribution — Stacked Bar ===== */}
      {type_distribution.length > 0 && (
        <View className='ac-card'>
          <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['shirt']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='ac-card-title'>衣物分类</Text></View>
          <StackedBar data={type_distribution} />
        </View>
      )}

      {/* ===== Color Palette ===== */}
      {color_distribution.length > 0 && (
        <View className='ac-card'>
          <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['palette']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='ac-card-title'>色系图谱</Text></View>
          <ColorPalette data={color_distribution} />
        </View>
      )}

      {/* ===== Activity Heatmap ===== */}
      {activity && activity.length > 0 && (
        <View className='ac-card'>
          <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['flame']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='ac-card-title'>近 28 天穿搭活跃度</Text></View>
          <Heatmap data={activity} />
        </View>
      )}

      {/* ===== Most Worn ===== */}
      {most_worn.length > 0 && (
        <View className='ac-card'>
          <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['crown']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='ac-card-title'>最常穿</Text></View>
          {most_worn.map((item, idx) => (
            <WearItem key={item.id} item={item} delay={idx * 60} />
          ))}
        </View>
      )}

      {/* ===== Never Worn ===== */}
      {never_worn.length > 0 && (
        <View className='ac-card'>
          <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['moon']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='ac-card-title'>从未穿过</Text></View>
          {never_worn.map((item, idx) => (
            <WearItem key={item.id} item={item} delay={idx * 60} />
          ))}
        </View>
      )}

      {/* ===== Learning Profile ===== */}
      {learning?.profile?.has_learning_data && (
        <View className='ac-card'>
          <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['brain']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='ac-card-title'>AI 学习画像</Text></View>
          <View className='ac-learning-stats'>
            <View className='ac-learning-stat'>
              <Text className='ac-learning-stat-value'>{learning.profile.feedback_count}</Text>
              <Text className='ac-learning-stat-label'>反馈次数</Text>
            </View>
            <View className='ac-learning-stat'>
              <Text className='ac-learning-stat-value'>{learning.profile.outfits_rated}</Text>
              <Text className='ac-learning-stat-label'>已评分搭配</Text>
            </View>
            <View className='ac-learning-stat'>
              <Text className='ac-learning-stat-value'>
                {learning.profile.overall_acceptance_rate !== null
                  ? `${Math.round(learning.profile.overall_acceptance_rate * 100)}%`
                  : '-'}
              </Text>
              <Text className='ac-learning-stat-label'>采纳率</Text>
            </View>
            <View className='ac-learning-stat'>
              <Text className='ac-learning-stat-value'>
                {learning.profile.average_rating !== null
                  ? learning.profile.average_rating.toFixed(1)
                  : '-'}
              </Text>
              <Text className='ac-learning-stat-label'>平均评分</Text>
            </View>
          </View>
        </View>
      )}

      {/* ===== Learned Insights ===== */}
      {learning?.insights && learning.insights.length > 0 && (
        <View className='ac-card'>
          <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['search']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='ac-card-title'>深度洞察</Text></View>
          {learning.insights.map((insight, idx) => (
            <View key={insight.id} className='ac-insight animate-fade-in-up' style={{ animationDelay: `${idx * 60}ms` }}>
              <View className='ac-insight-header'>
                <Text className='ac-insight-title'>{insight.title}</Text>
                <Text className='ac-insight-confidence'>{Math.round(insight.confidence * 100)}%</Text>
              </View>
              <Text className='ac-insight-desc'>{insight.description}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={{ height: '60rpx' }} />
    </ScrollView>
  )
}
