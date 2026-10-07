import { View, Text, ScrollView, Image } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState, useMemo, useCallback, useEffect } from 'react'
import { api, resolveImageUrl } from '../../utils/api'
import { getLocationAndSave } from '../../utils/location'
import { WEATHER_CONDITION_CN } from '../../constants'
import CachedImage from '../../components/CachedImage'
import './index.scss'
import { icons } from '../../constants/icons'

// ===== Types =====

interface WeatherDay {
  date: string
  weekday: string
  icon: string
  condition: string
  tempMin: number
  tempMax: number
  humidity: number
  wind: string
  tip: string
}

interface OutfitRecord {
  id: string
  name?: string
  occasion?: string
  reasoning?: string
  items: { id: string; type: string; name?: string; thumbnail_url?: string }[]
  model_image_url?: string
  scheduled_for?: string
}

interface ForecastDay {
  date: string
  temp_min: number
  temp_max: number
  precipitation_chance: number
  condition: string
  condition_code: number
}

// ===== Helpers =====

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function getWeatherIcon(condition: string): string {
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

function getWeatherTip(condition: string, tempMin: number, tempMax: number): string {
  const c = (condition || '').toLowerCase()
  const avg = (tempMin + tempMax) / 2

  if (c.includes('rain') || c.includes('drizzle')) {
    if (c.includes('heavy')) return '大雨天尽量少出门，室内穿搭也要精致'
    return '记得带伞，穿防水面料的外套'
  }
  if (c.includes('snow')) return '雪天注意保暖，深色系不容易显脏'
  if (c.includes('thunder')) return '雷雨天待在室内，明天再美美出门'
  if (c.includes('fog')) return '雾天能见度低，穿亮色外套更安全'

  if (avg >= 33) return '高温天注意防晒，浅色透气面料优先'
  if (avg >= 28) return '天气炎热，短袖短裤安排上'
  if (avg >= 23) return '天气不错，短袖+薄外套刚刚好'
  if (avg >= 18) return '微凉天气，长袖或薄针织很舒适'
  if (avg >= 13) return '有点冷了，记得加件外套'
  if (avg >= 5) return '天气较冷，大衣+围巾保暖又有型'
  return '严寒天气，羽绒服是刚需，注意保暖'
}

function getBgGradient(condition: string): string {
  const c = (condition || '').toLowerCase()
  if (c.includes('sunny') || c === 'clear') return 'linear-gradient(180deg, #87CEEB 0%, #B0E0E6 40%, #F7F8FA 100%)'
  if (c.includes('cloud') || c === 'overcast') return 'linear-gradient(180deg, #A8C0D0 0%, #C8D8E4 40%, #F7F8FA 100%)'
  if (c.includes('rain') || c.includes('drizzle')) return 'linear-gradient(180deg, #708090 0%, #A0AEB8 40%, #F7F8FA 100%)'
  if (c.includes('snow')) return 'linear-gradient(180deg, #E8EEF4 0%, #F0F4F8 40%, #F7F8FA 100%)'
  if (c.includes('thunder')) return 'linear-gradient(180deg, #4A5568 0%, #718096 40%, #F7F8FA 100%)'
  return 'linear-gradient(180deg, #87CEEB 0%, #B0E0E6 40%, #F7F8FA 100%)'
}

function getWeekday(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return '今日'
  const tomorrow = new Date(todayStr)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (dateStr === tomorrow.toISOString().slice(0, 10)) return '明日'
  const d = new Date(dateStr)
  return WEEKDAY_NAMES[d.getDay()]
}

function formatWind(speed: number): string {
  if (speed < 2) return '无风'
  if (speed < 12) return '微风'
  if (speed < 20) return '3级风'
  if (speed < 29) return '4级风'
  if (speed < 39) return '5级风'
  return '大风'
}

// ===== Component =====

export default function OotdPage() {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const [outfit, setOutfit] = useState<OutfitRecord | null>(null)
  const [loadingOutfit, setLoadingOutfit] = useState(false)
  const [weather, setWeather] = useState<WeatherDay[]>([])
  const [locationName, setLocationName] = useState('')
  const [loadingWeather, setLoadingWeather] = useState(true)

  const selectedDay = useMemo(() =>
    weather.find(d => d.date === selectedDate) || weather[0] || {
      date: todayStr, weekday: '今日', icon: icons['cloud-sun'], condition: '',
      tempMin: 0, tempMax: 0, humidity: 0, wind: '', tip: '正在获取天气...'
    },
    [selectedDate, weather, todayStr]
  )

  const bgGradient = useMemo(() => getBgGradient(selectedDay.condition), [selectedDay.condition])
  const isToday = selectedDate === todayStr

  // 加载真实天气数据
  useEffect(() => {
    const loadWeather = async () => {
      setLoadingWeather(true)
      try {
        const loc = await Promise.race([
          getLocationAndSave(),
          new Promise<null>(r => setTimeout(() => r(null), 5000))
        ])

        const wp: Record<string, string> = {}
        if (loc) {
          wp.latitude = String(loc.latitude)
          wp.longitude = String(loc.longitude)
        }

        // 并行请求当前天气（获取城市名）和 7 天预报
        const [currentRes, forecastRes] = await Promise.allSettled([
          api.get<any>('/weather/current', wp).catch(() => null),
          api.get<any>('/weather/forecast', { ...wp, days: '7' }).catch(() => null),
        ])

        // 城市名
        if (currentRes.status === 'fulfilled' && currentRes.value) {
          setLocationName(currentRes.value.city || '')
        }

        // 预报数据
        if (forecastRes.status === 'fulfilled' && forecastRes.value?.forecast) {
          const forecast: ForecastDay[] = forecastRes.value.forecast
          const days: WeatherDay[] = forecast.map((d) => ({
            date: d.date,
            weekday: getWeekday(d.date, todayStr),
            icon: getWeatherIcon(d.condition),
            condition: getConditionCN(d.condition),
            tempMin: Math.round(d.temp_min),
            tempMax: Math.round(d.temp_max),
            humidity: 50,
            wind: '',
            tip: getWeatherTip(d.condition, d.temp_min, d.temp_max),
          }))
          if (days.length > 0) {
            setWeather(days)
            // 如果当前选中日期不在预报范围内，选第一天
            if (!days.find(d => d.date === selectedDate)) {
              setSelectedDate(days[0].date)
            }
          }
        }
      } catch (err) {
        console.error('Load weather failed:', err)
      } finally {
        setLoadingWeather(false)
      }
    }
    loadWeather()
  }, [])

  // 查询选中日期的穿搭记录
  useEffect(() => {
    loadOutfit(selectedDate)
  }, [selectedDate])

  const loadOutfit = async (date: string) => {
    setLoadingOutfit(true)
    setOutfit(null)
    try {
      const data = await api.get<OutfitRecord>('/outfits', {
        date_from: date,
        date_to: date,
        page: '1',
        page_size: '1',
      })
      // 后端返回列表，取第一条
      const record = (data as any).items?.[0] || null
      setOutfit(record)
    } catch {
      // 404 或空数据，显示空状态
      setOutfit(null)
    } finally {
      setLoadingOutfit(false)
    }
  }

  const handleUpload = useCallback(() => {
    Taro.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: (res) => {
        if (res.tempFiles?.length) {
          Taro.navigateTo({ url: '/pages/parse/index?tab=flat&auto=1' })
        }
      },
    })
  }, [])

  const handleCreate = useCallback(() => {
    Taro.navigateTo({ url: '/pages/diy/index' })
  }, [])

  const handleImport = useCallback(() => {
    Taro.switchTab({ url: '/pages/suggest/index' })
  }, [])

  return (
    <View className='ootd-page' style={{ background: bgGradient }}>
      {/* ===== 天气顶栏 ===== */}
      <View className='ootd-header'>
        {/* 定位 */}
        <View className='ootd-location'>
          <Image src={icons['map-pin']} className='ootd-location-icon' style={{width: '48rpx', height: '48rpx'}} />
          <Text className='ootd-location-text'>{locationName || '定位中...'}</Text>
        </View>

        {/* 当前天气大字 */}
        <View className='ootd-current'>
          <Image src={selectedDay.icon} className='ootd-current-icon' style={{width: '48rpx', height: '48rpx'}} />
          <View className='ootd-current-info'>
            <Text className='ootd-current-temp'>{selectedDay.tempMin}°~{selectedDay.tempMax}°</Text>
            <Text className='ootd-current-condition'>{selectedDay.condition} {selectedDay.wind}</Text>
          </View>
          <View className='ootd-current-extra'>
            <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['droplets']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='ootd-current-humidity'>{selectedDay.humidity}%</Text></View>
          </View>
        </View>

        {/* 7天预报条 */}
        {loadingWeather && weather.length === 0 ? (
          <View className='ootd-forecast-loading'>
            <Text className='ootd-forecast-loading-text'>获取天气中...</Text>
          </View>
        ) : (
        <ScrollView scrollX className='ootd-forecast-scroll'>
          <View className='ootd-forecast-list'>
            {weather.map((day) => {
              const isSelected = day.date === selectedDate
              return (
                <View
                  key={day.date}
                  className={`ootd-forecast-day ${isSelected ? 'ootd-forecast-day--selected' : ''}`}
                  onClick={() => setSelectedDate(day.date)}
                >
                  <Text className='ootd-forecast-weekday'>{day.weekday}</Text>
                  <Text className='ootd-forecast-date'>{day.date.slice(5)}</Text>
                  <Image src={day.icon} className='ootd-forecast-icon' style={{width: '48rpx', height: '48rpx'}} />
                  <Text className='ootd-forecast-temp'>{day.tempMin}°/{day.tempMax}°</Text>
                </View>
              )
            })}
          </View>
        </ScrollView>
        )}
      </View>

      {/* ===== 核心内容区 ===== */}
      <View className='ootd-body'>
        {/* 加载中 */}
        {loadingOutfit && (
          <View className='ootd-loading'>
            <View className='ootd-loading-ring' />
            <Text className='ootd-loading-text'>正在查找穿搭记录...</Text>
          </View>
        )}

        {/* 有穿搭记录：展示真实数据 */}
        {!loadingOutfit && outfit && (
          <View className='ootd-record animate-fade-in-up'>
            {outfit.model_image_url && (
              <View className='ootd-record-img-wrap'>
                <CachedImage
                  className='ootd-record-img'
                  src={resolveImageUrl(outfit.model_image_url) || ''}
                  mode='aspectFill'
                />
              </View>
            )}
            <View className='ootd-record-info'>
              <Text className='ootd-record-title'>{outfit.name || `${selectedDay.weekday}穿搭`}</Text>
              {outfit.occasion && <Text className='ootd-record-occasion'>{outfit.occasion}</Text>}
              {outfit.reasoning && <Text className='ootd-record-reason'>{outfit.reasoning}</Text>}
              <View className='ootd-record-items'>
                {(outfit.items || []).map((item) => (
                  <View key={item.id} className='ootd-record-item'>
                    {item.thumbnail_url ? (
                      <CachedImage
                        className='ootd-record-item-img'
                        src={resolveImageUrl(item.thumbnail_url) || ''}
                        mode='aspectFill'
                      />
                    ) : (
                      <View className='ootd-record-item-placeholder'>
                        <Image src={icons['shirt']} style={{width: '48rpx', height: '48rpx'}} />
                      </View>
                    )}
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}

        {/* 无穿搭记录：空状态 + 操作按钮 */}
        {!loadingOutfit && !outfit && (
          <>
            <View className='ootd-empty'>
              <View className='ootd-empty-card'>
                <Image src={icons['shirt']} className='ootd-empty-icon' style={{width: '48rpx', height: '48rpx'}} />
                <Text className='ootd-empty-title'>
                  {isToday ? '今天还没有记录穿搭' : `${selectedDay.weekday}暂未记录穿搭`}
                </Text>
                <Text className='ootd-empty-desc'>
                  {isToday
                    ? `${selectedDay.tempMin}°~${selectedDay.tempMax}°，${selectedDay.condition}天`
                    : `预计${selectedDay.tempMin}°~${selectedDay.tempMax}°，${selectedDay.condition}`}
                </Text>
              </View>
            </View>

            <View className='ootd-actions'>
              <View className='ootd-action-btn press-scale' onClick={handleUpload}>
                <Image src={icons['camera']} className='ootd-action-icon' style={{width: '48rpx', height: '48rpx'}} />
                <Text className='ootd-action-text'>上传穿搭照片</Text>
              </View>
              <View className='ootd-action-btn press-scale' onClick={handleCreate}>
                <Image src={icons['plus']} className='ootd-action-icon' style={{width: '48rpx', height: '48rpx'}} />
                <Text className='ootd-action-text'>手动创建穿搭</Text>
              </View>
              <View className='ootd-action-btn press-scale' onClick={handleImport}>
                <Image src={icons['wand-sparkles']} className='ootd-action-icon' style={{width: '48rpx', height: '48rpx'}} />
                <Text className='ootd-action-text'>导入推荐穿搭</Text>
              </View>
            </View>
          </>
        )}
      </View>

      {/* ===== 底部穿搭建议栏 ===== */}
      <View className='ootd-advice'>
        <Text className='ootd-advice-label'>穿搭建议</Text>
        <Text className='ootd-advice-text'>{selectedDay.tip}</Text>
      </View>
    </View>
  )
}
