import { View, Text, ScrollView, Image } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState, useMemo, useCallback, useEffect } from 'react'
import { api, resolveImageUrl } from '../../utils/api'
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

// ===== Mock Weather (保留，未来接入真实 API) =====

const MOCK_LOCATION = '贵阳市花溪区'

const MOCK_WEATHER: WeatherDay[] = [
  { date: '2026-06-02', weekday: '今日', icon: icons['sun'], condition: '晴', tempMin: 20, tempMax: 28, humidity: 45, wind: '微风', tip: '天气不错，短袖+薄外套刚刚好' },
  { date: '2026-06-03', weekday: '明日', icon: icons['cloud'], condition: '多云', tempMin: 19, tempMax: 26, humidity: 55, wind: '微风', tip: '多云天适合浅色系穿搭' },
  { date: '2026-06-04', weekday: '周四', icon: icons['sun'], condition: '小雨', tempMin: 17, tempMax: 23, humidity: 80, wind: '北风3级', tip: '记得带伞，穿防水面料的外套' },
  { date: '2026-06-05', weekday: '周五', icon: icons['sun'], condition: '中雨', tempMin: 16, tempMax: 22, humidity: 85, wind: '北风4级', tip: '雨天穿搭以深色为主，不容易显脏' },
  { date: '2026-06-06', weekday: '周六', icon: icons['cloud'], condition: '多云', tempMin: 18, tempMax: 25, humidity: 60, wind: '微风', tip: '周末出门，休闲风很合适' },
  { date: '2026-06-07', weekday: '周日', icon: icons['sun'], condition: '晴', tempMin: 21, tempMax: 30, humidity: 40, wind: '微风', tip: '高温天注意防晒，浅色透气面料优先' },
  { date: '2026-06-08', weekday: '周一', icon: icons['sun'], condition: '晴', tempMin: 22, tempMax: 31, humidity: 38, wind: '微风', tip: '又是晴天，短裤短袖安排上' },
]

// ===== Helpers =====

function getBgGradient(condition: string): string {
  if (condition.includes('晴')) return 'linear-gradient(180deg, #87CEEB 0%, #B0E0E6 40%, #F7F8FA 100%)'
  if (condition.includes('多云')) return 'linear-gradient(180deg, #A8C0D0 0%, #C8D8E4 40%, #F7F8FA 100%)'
  if (condition.includes('雨')) return 'linear-gradient(180deg, #708090 0%, #A0AEB8 40%, #F7F8FA 100%)'
  if (condition.includes('雪')) return 'linear-gradient(180deg, #E8EEF4 0%, #F0F4F8 40%, #F7F8FA 100%)'
  return 'linear-gradient(180deg, #87CEEB 0%, #B0E0E6 40%, #F7F8FA 100%)'
}

// ===== Weather API 坑位（未来接入） =====
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function fetchWeather(_latitude?: number, _longitude?: number): Promise<WeatherDay[]> {
  // TODO: 接入 GET /weather/forecast 真实 API
  // const data = await api.get<{ forecast: WeatherDay[] }>('/weather/forecast', {
  //   latitude: String(latitude),
  //   longitude: String(longitude),
  //   days: '7',
  // })
  // return data.forecast || []
  return MOCK_WEATHER
}

// ===== Component =====

export default function OotdPage() {
  const [selectedDate, setSelectedDate] = useState(MOCK_WEATHER[0].date)
  const [outfit, setOutfit] = useState<OutfitRecord | null>(null)
  const [loadingOutfit, setLoadingOutfit] = useState(false)
  const [weather, setWeather] = useState<WeatherDay[]>(MOCK_WEATHER)

  const selectedDay = useMemo(() =>
    weather.find(d => d.date === selectedDate) || weather[0],
    [selectedDate, weather]
  )

  const bgGradient = useMemo(() => getBgGradient(selectedDay.condition), [selectedDay.condition])
  const isToday = selectedDate === weather[0]?.date

  // 加载天气（预留真实 API）
  useEffect(() => {
    fetchWeather().then(setWeather)
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
          Taro.navigateTo({ url: '/pages/evaluation/index' })
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
          <Text className='ootd-location-text'>{MOCK_LOCATION}</Text>
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
