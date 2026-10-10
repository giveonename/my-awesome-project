import { View, Text, ScrollView, Image} from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { api, getAccessToken, resolveImageUrl, API_BASE } from '../../utils/api'
import { getLocationAndSave } from '../../utils/location'
import { WeatherData, UserProfile, ClothingItem } from '../../types'
import { WEATHER_CONDITION_CN, getItemDisplayName } from '../../constants'
import CachedImage from '../../components/CachedImage'
import './index.scss'
import { icons } from '../../constants/icons'

// Weather hero backgrounds are served by the backend itself (local assets in
// backend/app/assets/weather-bg/, replacing the retired OSS bucket). When a
// file is absent, the gradient layer below keeps the hero looking right.
const WEATHER_BG_BASE = `${API_BASE}/weather/backgrounds`
const sunny = WEATHER_BG_BASE + '/sunny.png'
const cloudy = WEATHER_BG_BASE + '/cloudy.png'
const rainy = WEATHER_BG_BASE + '/rainy.png'
const snowy = WEATHER_BG_BASE + '/snowy.png'
const foggy = WEATHER_BG_BASE + '/foggy.png'
const thunderstorm = WEATHER_BG_BASE + '/thunderstorm.png'
const WEATHER_BG_FALLBACK = 'linear-gradient(135deg, #DCEEE4 0%, #FAF7F2 100%)'

// ===== Helpers =====

function getGreeting(): { text: string; tip: string } {
  const h = new Date().getHours()
  if (h < 6) return { text: '夜猫子还没睡呀', tip: '早点休息，明天才能穿得好看' }
  if (h < 9) return { text: '早上好', tip: '新的一天，从一身好搭配开始' }
  if (h < 12) return { text: '上午好', tip: '今天的天气很适合出门走走' }
  if (h < 14) return { text: '中午好', tip: '午休时也可以逛逛衣橱找灵感' }
  if (h < 18) return { text: '下午好', tip: '要不要试试新的搭配风格？' }
  if (h < 21) return { text: '傍晚好', tip: '晚上出门的话记得带件外套' }
  return { text: '晚上好', tip: '睡前想好明天穿什么了吗？' }
}

function getWeatherEmoji(condition: string): string {
  const c = (condition || '').toLowerCase()
  if (c.includes('sunny') || c === 'clear') return icons['sun']
  if (c.includes('cloud') || c === 'overcast') return icons['cloud']
  if (c.includes('rain') || c.includes('drizzle')) return icons['cloud-rain']
  if (c.includes('snow')) return icons['snowflake']
  if (c.includes('thunder')) return icons['cloud-lightning']
  if (c.includes('fog')) return icons['cloud-fog']
  return icons['cloud-sun']
}

function getConditionCN(condition: string): string {
  const c = (condition || '').toLowerCase()
  if (c.includes('sunny') || c === 'clear') return '晴'
  if (c === 'overcast') return '阴'
  if (c.includes('cloud')) return '多云'
  if (c.includes('rain') || c.includes('drizzle')) return '雨'
  if (c.includes('snow')) return '雪'
  return WEATHER_CONDITION_CN[condition] || condition || ''
}

function getWeatherBg(condition: string): string {
  const c = (condition || '').toLowerCase()
  if (c.includes('sunny') || c === 'clear') return sunny
  if (c.includes('cloud') || c === 'overcast') return cloudy
  if (c.includes('rain') || c.includes('drizzle')) return rainy
  if (c.includes('snow')) return snowy
  if (c.includes('thunder')) return thunderstorm
  if (c.includes('fog') || c.includes('haze') || c.includes('mist')) return foggy
  return sunny
}

// ===== Capsule entries =====
const CAPSULE_ENTRIES = [
  { icon: icons['bot'], label: 'AI 造型师', page: '/pages/chat/index', accent: true },
  { icon: icons['target'], label: 'AI 搭配', page: '/pages/suggest/index' },
  { icon: icons['gem'], label: '会员中心', page: '/pages/membership/index' },
  { icon: icons['trending-up'], label: '穿搭统计', page: '/pages/analytics/index' },
  { icon: icons['calendar'], label: '穿搭日历', page: '/pages/history/index' },
]

// ===== Mock community posts =====
const MOCK_COMMUNITY_POSTS = [
  { user: '小雅', text: '这件白色连衣裙太好看了，夏天必备！', likes: 23 },
  { user: '阿杰', text: '求帮忙搭配这套面试穿的', likes: 15 },
  { user: '思思', text: 'AI 推荐的这套约会穿搭绝了', likes: 42 },
  { user: '大明', text: '运动风也能很时尚，分享我的健身穿搭', likes: 18 },
]

export default function HomePage() {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [weatherBg, setWeatherBg] = useState<string>('')
  const [recentItems, setRecentItems] = useState<ClothingItem[]>([])
  const [itemCount, setItemCount] = useState(0)
  const [bannerIndex, setBannerIndex] = useState(0)
  const bannerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const greeting = useMemo(() => getGreeting(), [])

  useEffect(() => {
    bannerTimerRef.current = setInterval(() => {
      setBannerIndex(prev => (prev + 1) % MOCK_COMMUNITY_POSTS.length)
    }, 3500)
    return () => { if (bannerTimerRef.current) clearInterval(bannerTimerRef.current) }
  }, [])

  useDidShow(() => {
    if (!getAccessToken()) { Taro.reLaunch({ url: '/pages/login/index' }); return }
    loadData()
  })

  const loadData = useCallback(async () => {
    try {
      const locPromise = getLocationAndSave()
      const [profileRes, itemsRes, recentRes] = await Promise.allSettled([
        api.get<UserProfile>('/users/me'),
        api.get<{ total: number }>('/items', { page: '1', page_size: '1' }),
        api.get<{ items: ClothingItem[] }>('/items', { page: '1', page_size: '5', sort: 'created_at' }),
      ])
      if (profileRes.status === 'fulfilled') setUser(profileRes.value)
      if (itemsRes.status === 'fulfilled') setItemCount(itemsRes.value.total || 0)
      if (recentRes.status === 'fulfilled') setRecentItems(recentRes.value.items || [])
      const loc = await locPromise
      const wp: Record<string, string> = {}
      if (loc) { wp.latitude = String(loc.latitude); wp.longitude = String(loc.longitude) }
      try { const wd = await api.get<WeatherData>('/weather/current', wp).catch(() => null); if (wd) { setWeather(wd); setWeatherBg(getWeatherBg(wd.condition || '')) } } catch {}
    } catch (err) { console.error('Load data failed:', err) }
  }, [])

  const handleNavigate = useCallback((page: string) => {
    if (page.startsWith('/pages/suggest') || page.startsWith('/pages/wardrobe') || page.startsWith('/pages/profile')) {
      Taro.switchTab({ url: page })
    } else {
      Taro.navigateTo({ url: page })
    }
  }, [])

  const currentBanner = MOCK_COMMUNITY_POSTS[bannerIndex]

  return (
    <View className='home-page'>
      <ScrollView className='home-scroll' scrollY>
        {/* ===== Hero Zone ===== */}
        <View className='home-hero'>
          <View className='home-hero-bg' style={{ backgroundImage: weatherBg ? `url(${weatherBg}), ${WEATHER_BG_FALLBACK}` : 'none' }} />
          <View className='home-hero-weather'>
            <View className='home-hero-weather-left'>
              <Image src={getWeatherEmoji(weather?.condition || '')} style={{width: '64rpx', height: '64rpx'}} />
              <Text className='home-hero-weather-temp'>{weather ? `${Math.round(weather.temperature)}°` : '--'}</Text>
              <Text className='home-hero-weather-cond'>{getConditionCN(weather?.condition || '')}</Text>
            </View>
            <Text className='home-hero-weather-loc'>{weather?.city || '正在获取位置...'}</Text>
          </View>
          <View className='home-hero-greeting'>
            <Text className='home-hero-greeting-name'>{greeting.text}{user?.nickname ? `，${user.nickname}` : ''}</Text>
            <Text className='home-hero-greeting-tip'>{greeting.tip}</Text>
          </View>
          <View className='home-hero-cards'>
            <View className='home-hero-card home-hero-card--wardrobe' onClick={() => handleNavigate('/pages/wardrobe/index')}>
              <View className='home-hero-card-wardrobe-top'>
                <Image src={icons['shirt']} className='home-hero-card-wardrobe-icon' style={{width: '48rpx', height: '48rpx'}} />
                <Text className='home-hero-card-wardrobe-title'>我的衣橱</Text>
                <Text className='home-hero-card-wardrobe-count'>{itemCount} 件</Text>
              </View>
              <View className='home-hero-card-upload-btn' onClick={(e) => { e.stopPropagation(); Taro.navigateTo({ url: '/pages/parse/index?tab=flat' }) }}>
                <Text className='home-hero-card-upload-icon'>⬆️</Text>
                <Text className='home-hero-card-upload-text'>上传衣服</Text>
              </View>
            </View>
            <View className='home-hero-card-right-col'>
              <View className='home-hero-card home-hero-card--ootd' onClick={() => Taro.navigateTo({ url: '/pages/ootd/index' })}>
                <Image src={icons['camera']} className='home-hero-card-sm-icon' style={{width: '48rpx', height: '48rpx'}} />
                <Text className='home-hero-card-sm-title'>今日穿搭</Text>
                <Text className='home-hero-card-sm-desc'>记录今天穿了啥</Text>
              </View>
              <View className='home-hero-card home-hero-card--diy' onClick={() => handleNavigate('/pages/diy/index')}>
                <Image src={icons['hand']} className='home-hero-card-sm-icon' style={{width: '48rpx', height: '48rpx'}} />
                <Text className='home-hero-card-sm-title'>搭配 DIY</Text>
                <Text className='home-hero-card-sm-desc'>自由搭配画板</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ===== Capsule Function Pills ===== */}
        <View className='home-capsules'>
          <ScrollView scrollX className='home-capsules-scroll' enhanced showScrollbar={false}>
            <View className='home-capsules-list'>
              {CAPSULE_ENTRIES.map((entry) => (
                <View key={entry.page} className={`home-capsule ${entry.accent ? 'home-capsule--accent' : ''}`} onClick={() => handleNavigate(entry.page)}>
                  <Image src={entry.icon} className='home-capsule-icon' style={{width: '48rpx', height: '48rpx'}} />
                  <Text className='home-capsule-label'>{entry.label}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* ===== Community Banner ===== */}
        <View className='home-community-banner' onClick={() => Taro.navigateTo({ url: '/pages/community/index' })}>
          <View className='home-community-banner-header'>
            <View className='home-community-banner-title-row'>
              <Image src={icons['users']} className='home-community-banner-icon' style={{width: '48rpx', height: '48rpx'}} />
              <Text className='home-community-banner-title'>帮 Ta 搭配</Text>
            </View>
            <View className='home-community-banner-right'>
              <View className='home-community-ai-small' onClick={(e) => { e.stopPropagation(); Taro.navigateTo({ url: '/pages/chat/index' }) }}>
                <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['bot']} style={{width: '28rpx', height: '28rpx', marginRight: '4rpx'}} /><Text className='home-community-ai-small-text'>AI造型师</Text></View>
              </View>
              <Text className='home-community-banner-more'>进入社区 ›</Text>
            </View>
          </View>
          <View className='home-community-banner-carousel'>
            <View className='home-community-banner-post' key={bannerIndex}>
              <Text className='home-community-banner-post-user'>{currentBanner.user}</Text>
              <Text className='home-community-banner-post-text'>{currentBanner.text}</Text>
              <Text className='home-community-banner-post-likes'>{currentBanner.likes}</Text>
            </View>
          </View>
          <View className='home-community-banner-dots'>
            {MOCK_COMMUNITY_POSTS.map((_, i) => (
              <View key={i} className={`home-community-banner-dot ${i === bannerIndex ? 'home-community-banner-dot--active' : ''}`} />
            ))}
          </View>
        </View>

        {/* ===== Recent Items ===== */}
        {recentItems.length > 0 && (
          <View className='home-recent'>
            <View className='home-recent-header'>
              <Text className='home-recent-title'>最近添加</Text>
              <View className='home-recent-more' onClick={() => Taro.switchTab({ url: '/pages/wardrobe/index' })}>
                <Text className='home-recent-more-text'>查看全部 ›</Text>
              </View>
            </View>
            <ScrollView scrollX className='home-recent-scroll'>
              <View className='home-recent-list'>
                {recentItems.map((item, idx) => (
                  <View key={item.id} className='home-recent-item animate-fade-in-up' style={{ animationDelay: `${idx * 60}ms` }} onClick={() => Taro.navigateTo({ url: `/pages/item-detail/index?id=${item.id}` })}>
                    {item.thumbnail_url ? (
                      <CachedImage className='home-recent-item-img' src={resolveImageUrl(item.thumbnail_url) || ''} mode='aspectFill' />
                    ) : (
                      <View className='home-recent-item-placeholder'><Image src={icons['shirt']} style={{width: '48rpx', height: '48rpx'}} /></View>
                    )}
                    <Text className='home-recent-item-name'>{getItemDisplayName(item.name, item.type)}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        )}
        <View style={{ height: '260rpx' }} />
      </ScrollView>
    </View>
  )
}
