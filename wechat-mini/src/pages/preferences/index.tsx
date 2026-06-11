import { View, Text, ScrollView } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState, useRef, useCallback } from 'react'
import { api } from '../../utils/api'
import { COLOR_MAP, COLOR_LABELS_CN } from '../../constants'
import './index.scss'

interface PreferencesData {
  gender: string | null
  color_favorites: string[]
  color_avoid: string[]
  style_profile: Record<string, number>
  default_occasion: string
  temperature_unit: string
  temperature_sensitivity: string
  cold_threshold: number
  hot_threshold: number
  layering_preference: string
  avoid_repeat_days: number
  prefer_underused_items: boolean
  variety_level: string
}

const GENDER_OPTIONS = [
  { key: 'male', label: '男' },
  { key: 'female', label: '女' },
  { key: 'non-binary', label: '其他' },
  { key: 'prefer-not-to-say', label: '不想说' },
]

const STYLE_LABELS: Record<string, string> = {
  casual: '休闲',
  formal: '正式',
  sporty: '运动',
  minimalist: '简约',
  bold: '大胆',
}

const OCCASION_OPTIONS = [
  { key: 'casual', label: '日常' },
  { key: 'work', label: '上班' },
  { key: 'formal', label: '正式' },
  { key: 'date', label: '约会' },
  { key: 'sport', label: '运动' },
]

const TEMPERATURE_SENSITIVITY = [
  { key: 'cold', label: '怕冷' },
  { key: 'normal', label: '正常' },
  { key: 'hot', label: '怕热' },
]

const VARIETY_LEVELS = [
  { key: 'low', label: '保守' },
  { key: 'moderate', label: '适中' },
  { key: 'high', label: '多样' },
]

const AVAILABLE_COLORS = Object.keys(COLOR_MAP).slice(0, 14)

interface NotificationSetting {
  id: string
  channel: string
  enabled: boolean
  priority: number
}

export default function PreferencesPage() {
  const [prefs, setPrefs] = useState<PreferencesData | null>(null)
  const [notifSettings, setNotifSettings] = useState<NotificationSetting[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useDidShow(() => {
    loadPreferences()
  })

  const loadPreferences = async () => {
    setLoading(true)
    try {
      const [prefsRes, notifRes] = await Promise.allSettled([
        api.get<PreferencesData>('/users/me/preferences'),
        api.get<NotificationSetting[]>('/notifications/settings'),
      ])
      if (prefsRes.status === 'fulfilled') setPrefs(prefsRes.value)
      if (notifRes.status === 'fulfilled') setNotifSettings(notifRes.value || [])
    } catch (err) {
      console.error('Failed to load preferences:', err)
      Taro.showToast({ title: '加载出了点问题', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingUpdate = useRef<Partial<PreferencesData>>({})

  const flushSave = useCallback(async () => {
    if (!prefs || Object.keys(pendingUpdate.current).length === 0) return
    const updated = { ...pendingUpdate.current }
    pendingUpdate.current = {}
    setSaving(true)
    try {
      await api.patch('/users/me/preferences', updated)
      Taro.showToast({ title: '保存好了', icon: 'success', duration: 1000 })
    } catch (err) {
      console.error('Failed to save preferences:', err)
      Taro.showToast({ title: '没保存上，再试一次？', icon: 'none' })
    } finally {
      setSaving(false)
    }
  }, [prefs])

  const savePreferences = (updated: Partial<PreferencesData>) => {
    if (!prefs) return
    const newPrefs = { ...prefs, ...updated }
    setPrefs(newPrefs)
    // Merge into pending batch
    pendingUpdate.current = { ...pendingUpdate.current, ...updated }
    // Debounce: wait 500ms of inactivity before saving
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flushSave, 500)
  }

  const toggleColorFavorite = (color: string) => {
    if (!prefs) return
    const current = prefs.color_favorites || []
    const updated = current.includes(color)
      ? current.filter(c => c !== color)
      : [...current, color]
    savePreferences({ color_favorites: updated })
  }

  const updateStyleProfile = (key: string, value: number) => {
    if (!prefs) return
    const updated = { ...prefs.style_profile, [key]: value }
    savePreferences({ style_profile: updated })
  }

  if (loading) {
    return (
      <View className='prefs-page'>
        <View className='prefs-loading'>
          <Text className='prefs-loading-text'>加载中...</Text>
        </View>
      </View>
    )
  }

  if (!prefs) {
    return (
      <View className='prefs-page'>
        <View className='prefs-loading'>
          <Text className='prefs-loading-text'>加载失败</Text>
        </View>
      </View>
    )
  }

  return (
    <ScrollView scrollY className='prefs-page'>
      {/* Style Profile Sliders */}
      <View className='prefs-section'>
        <Text className='prefs-section-title'>风格偏好</Text>
        <Text className='prefs-section-desc'>调整滑块设置你对每种风格的喜好程度</Text>
        {Object.entries(STYLE_LABELS).map(([key, label]) => (
          <View key={key} className='style-slider-row'>
            <Text className='style-slider-label'>{label}</Text>
            <input
              type='range'
              className='style-slider'
              min={0}
              max={100}
              value={prefs.style_profile?.[key] ?? 50}
              onInput={(e: any) => updateStyleProfile(key, Number(e.detail.value))}
            />
            <Text className='style-slider-value'>{prefs.style_profile?.[key] ?? 50}</Text>
          </View>
        ))}
      </View>

      {/* Gender */}
      <View className='prefs-section'>
        <Text className='prefs-section-title'>性别</Text>
        <Text className='prefs-section-desc'>影响搭配推荐的品类和风格</Text>
        <View className='option-grid'>
          {GENDER_OPTIONS.map(opt => (
            <View
              key={opt.key}
              className={`option-chip ${prefs.gender === opt.key ? 'option-chip--active' : ''}`}
              onClick={() => savePreferences({ gender: opt.key })}
            >
              <Text className='option-chip-text'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Favorite Colors */}
      <View className='prefs-section'>
        <Text className='prefs-section-title'>喜欢的颜色</Text>
        <Text className='prefs-section-desc'>选择你喜欢的颜色，AI 会优先推荐</Text>
        <View className='color-grid'>
          {AVAILABLE_COLORS.map(color => (
            <View
              key={color}
              className={`color-option ${(prefs.color_favorites || []).includes(color) ? 'color-option--selected' : ''}`}
              onClick={() => toggleColorFavorite(color)}
            >
              <View
                className='color-circle'
                style={{ backgroundColor: COLOR_MAP[color] }}
              />
              <Text className='color-name'>{COLOR_LABELS_CN[color] || color}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Default Occasion */}
      <View className='prefs-section'>
        <Text className='prefs-section-title'>默认场合</Text>
        <View className='option-grid'>
          {OCCASION_OPTIONS.map(opt => (
            <View
              key={opt.key}
              className={`option-chip ${prefs.default_occasion === opt.key ? 'option-chip--active' : ''}`}
              onClick={() => savePreferences({ default_occasion: opt.key })}
            >
              <Text className='option-chip-text'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Temperature Sensitivity */}
      <View className='prefs-section'>
        <Text className='prefs-section-title'>温度敏感度</Text>
        <View className='option-grid'>
          {TEMPERATURE_SENSITIVITY.map(opt => (
            <View
              key={opt.key}
              className={`option-chip ${prefs.temperature_sensitivity === opt.key ? 'option-chip--active' : ''}`}
              onClick={() => savePreferences({ temperature_sensitivity: opt.key })}
            >
              <Text className='option-chip-text'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Avoid Repeat Days */}
      <View className='prefs-section'>
        <Text className='prefs-section-title'>避免重复天数</Text>
        <Text className='prefs-section-desc'>同一件衣物至少间隔多少天再推荐</Text>
        <View className='option-grid'>
          {[3, 5, 7, 14].map(days => (
            <View
              key={days}
              className={`option-chip ${prefs.avoid_repeat_days === days ? 'option-chip--active' : ''}`}
              onClick={() => savePreferences({ avoid_repeat_days: days })}
            >
              <Text className='option-chip-text'>{days} 天</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Variety Level */}
      <View className='prefs-section'>
        <Text className='prefs-section-title'>搭配多样性</Text>
        <View className='option-grid'>
          {VARIETY_LEVELS.map(opt => (
            <View
              key={opt.key}
              className={`option-chip ${prefs.variety_level === opt.key ? 'option-chip--active' : ''}`}
              onClick={() => savePreferences({ variety_level: opt.key })}
            >
              <Text className='option-chip-text'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Prefer Underused Items */}
      <View className='prefs-section'>
        <View className='toggle-row'>
          <View>
            <Text className='toggle-label'>优先推荐不常穿的衣物</Text>
            <Text className='toggle-desc'>让衣橱中被忽视的衣物获得更多出场机会</Text>
          </View>
          <View
            className={`toggle-switch ${prefs.prefer_underused_items ? 'toggle-switch--on' : ''}`}
            onClick={() => savePreferences({ prefer_underused_items: !prefs.prefer_underused_items })}
          >
            <View className='toggle-knob' />
          </View>
        </View>
      </View>

      {/* Notification Settings */}
      {notifSettings.length > 0 && (
        <View className='prefs-section'>
          <Text className='prefs-section-title'>通知渠道</Text>
          <Text className='prefs-section-desc'>管理你的消息推送方式</Text>
          {notifSettings.map((setting) => {
            const channelLabels: Record<string, string> = {
              ntfy: 'Ntfy 推送',
              mattermost: 'Mattermost',
              email: '邮件通知',
              expo_push: 'App 推送',
            }
            return (
              <View key={setting.id} className='toggle-row'>
                <View>
                  <Text className='toggle-label'>{channelLabels[setting.channel] || setting.channel}</Text>
                  <Text className='toggle-desc'>{setting.enabled ? '已开启' : '已关闭'}</Text>
                </View>
                <View
                  className={`toggle-switch ${setting.enabled ? 'toggle-switch--on' : ''}`}
                  onClick={async () => {
                    try {
                      await api.patch(`/notifications/settings/${setting.id}`, { enabled: !setting.enabled })
                      setNotifSettings(prev => prev.map(s =>
                        s.id === setting.id ? { ...s, enabled: !s.enabled } : s
                      ))
                    } catch {
                      Taro.showToast({ title: '设置没成功', icon: 'none' })
                    }
                  }}
                >
                  <View className='toggle-knob' />
                </View>
              </View>
            )
          })}
        </View>
      )}

      {saving && (
        <View className='prefs-saving'>
          <Text className='prefs-saving-text'>保存中...</Text>
        </View>
      )}

      <View className='prefs-bottom-spacer' />
    </ScrollView>
  )
}