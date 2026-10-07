import { View, Text, ScrollView, Slider, Image } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState, useCallback, useRef } from 'react'
import { api, getBodyProfile, updateBodyProfile, BodyProfileData, getBodyPhoto, uploadBodyPhoto, resolveImageUrl } from '../../utils/api'
import { COLOR_MAP, COLOR_LABELS_CN } from '../../constants'
import './index.scss'
import { icons } from '../../constants/icons'

type TabKey = 'basic' | 'body' | 'style'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'basic', label: '基本信息' },
  { key: 'body', label: '身材数据' },
  { key: 'style', label: '风格偏好' },
]

// ===== Options =====

const GENDER_OPTIONS = [
  { key: 'male', label: '男' },
  { key: 'female', label: '女' },
  { key: 'non-binary', label: '其他' },
  { key: 'prefer-not-to-say', label: '不想说' },
]

const AGE_OPTIONS = [
  { key: '18-24', label: '18-24' },
  { key: '25-30', label: '25-30' },
  { key: '31-40', label: '31-40' },
  { key: '40+', label: '40+' },
]

const PROFESSION_OPTIONS = [
  { key: 'student', label: '学生' },
  { key: 'office', label: '上班族' },
  { key: 'freelance', label: '自由职业' },
  { key: 'entrepreneur', label: '创业者' },
  { key: 'other', label: '其他' },
]

const SKIN_TONE_OPTIONS = [
  { key: 'fair', label: '白皙', color: '#FDEBD0' },
  { key: 'light', label: '偏白', color: '#F5CBA7' },
  { key: 'medium', label: '自然', color: '#E8B88A' },
  { key: 'tan', label: '小麦', color: '#D4A574' },
  { key: 'dark', label: '健康', color: '#C0956E' },
]

const BODY_SHAPE_OPTIONS = [
  { key: 'hourglass', label: '沙漏型', desc: '肩胯等宽，腰细' },
  { key: 'pear', label: '梨形', desc: '胯宽于肩' },
  { key: 'apple', label: '苹果型', desc: '腰腹较圆润' },
  { key: 'rectangle', label: '矩形', desc: '肩腰胯等宽' },
  { key: 'inverted-triangle', label: '倒三角', desc: '肩宽于胯' },
]

const BODY_BUILD_OPTIONS = [
  { key: 'slim', label: '偏瘦' },
  { key: 'standard', label: '标准' },
  { key: 'athletic', label: '健硕' },
  { key: 'curvy', label: '丰满' },
  { key: 'muscular', label: '壮实' },
]

const SHOULDER_OPTIONS = [
  { key: 'narrow', label: '窄肩' },
  { key: 'normal', label: '正常' },
  { key: 'broad', label: '宽肩' },
]

const LEG_TYPE_OPTIONS = [
  { key: 'straight', label: '直腿' },
  { key: 'x-leg', label: 'X型腿' },
  { key: 'o-leg', label: 'O型腿' },
]

const IMPROVE_OPTIONS = [
  { key: 'look-taller', label: '显高' },
  { key: 'look-slimmer', label: '显瘦' },
  { key: 'hide-belly', label: '遮肚子' },
  { key: 'longer-legs', label: '显腿长' },
  { key: 'wider-shoulders', label: '显肩宽' },
  { key: 'slim-arms', label: '显手臂细' },
  { key: 'hide-hips', label: '遮胯' },
]

const STYLE_OPTIONS = [
  { key: 'casual', label: '休闲' },
  { key: 'office', label: '通勤' },
  { key: 'sporty', label: '运动' },
  { key: 'minimalist', label: '极简' },
  { key: 'artistic', label: '文艺' },
  { key: 'streetwear', label: '潮流' },
  { key: 'elegant', label: '精致' },
  { key: 'bold', label: '大胆' },
]

const OCCASION_OPTIONS = [
  { key: 'casual', label: '日常' },
  { key: 'work', label: '上班' },
  { key: 'formal', label: '正式' },
  { key: 'date', label: '约会' },
  { key: 'sport', label: '运动' },
]

const TEMP_SENSITIVITY = [
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

// ===== Component =====

export default function ProfileSettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('basic')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  // Basic info
  const [gender, setGender] = useState('')
  const [ageRange, setAgeRange] = useState('')
  const [profession, setProfession] = useState('')
  const [skinTone, setSkinTone] = useState('')

  // Body data
  const [height, setHeight] = useState(170)
  const [weight, setWeight] = useState(60)
  const [bodyShape, setBodyShape] = useState('')
  const [bodyBuild, setBodyBuild] = useState('')
  const [shoulderType, setShoulderType] = useState('')
  const [legType, setLegType] = useState('')
  const [improveAreas, setImproveAreas] = useState<string[]>([])
  const [photoUrl, setPhotoUrl] = useState('')
  const [photoLoading, setPhotoLoading] = useState(false)

  // Style preferences
  const [styles, setStyles] = useState<string[]>([])
  const [defaultOccasion, setDefaultOccasion] = useState('')
  const [colorFavorites, setColorFavorites] = useState<string[]>([])
  const [tempSensitivity, setTempSensitivity] = useState('')
  const [varietyLevel, setVarietyLevel] = useState('')
  const [avoidRepeatDays, setAvoidRepeatDays] = useState(7)

  // Load data
  useDidShow(() => {
    loadAll()
  })

  const loadAll = async () => {
    setLoading(true)
    try {
      await Promise.all([
        loadOnboarding(),
        loadBodyProfile(),
        loadPreferences(),
        loadBodyPhoto(),
      ])
    } finally {
      setLoading(false)
    }
  }

  const loadOnboarding = async () => {
    try {
      const user = await api.get<any>('/users/me')
      if (user.gender) setGender(user.gender)
      if (user.age_range) setAgeRange(user.age_range)
      if (user.profession_scene) setProfession(user.profession_scene)
    } catch {}
  }

  const loadBodyProfile = async () => {
    try {
      const profile = await getBodyProfile()
      if (profile) {
        if (profile.height_cm) setHeight(profile.height_cm)
        if (profile.weight_kg) setWeight(profile.weight_kg)
        if (profile.body_type) setBodyShape(profile.body_type)
        if (profile.shoulder_type) setShoulderType(profile.shoulder_type)
        if (profile.leg_type) setLegType(profile.leg_type)
        if (profile.skin_tone) setSkinTone(profile.skin_tone)
        if (profile.want_to_improve?.length) setImproveAreas(profile.want_to_improve)
      }
    } catch {}
  }

  const loadPreferences = async () => {
    try {
      const prefs = await api.get<any>('/users/me/preferences')
      if (prefs.style_identity?.length) setStyles(prefs.style_identity)
      if (prefs.default_occasion) setDefaultOccasion(prefs.default_occasion)
      if (prefs.color_favorites?.length) setColorFavorites(prefs.color_favorites)
      if (prefs.temperature_sensitivity) setTempSensitivity(prefs.temperature_sensitivity)
      if (prefs.variety_level) setVarietyLevel(prefs.variety_level)
      if (prefs.avoid_repeat_days) setAvoidRepeatDays(prefs.avoid_repeat_days)
    } catch {}
  }

  const loadBodyPhoto = async () => {
    try {
      const res = await getBodyPhoto()
      if (res?.photo_url) setPhotoUrl(res.photo_url)
    } catch {}
  }

  // Save handlers
  const saveBasic = async () => {
    setSaving(true)
    try {
      await api.post('/chat/onboarding', {
        step: 1,
        data: { gender, age_range: ageRange, profession_scene: profession },
      })
      if (skinTone) {
        const profile = await getBodyProfile()
        await updateBodyProfile({ ...(profile || {}), skin_tone: skinTone } as any)
      }
      Taro.showToast({ title: '已保存', icon: 'success' })
    } catch {
      Taro.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  const saveBody = async () => {
    if (!bodyShape) {
      Taro.showToast({ title: '选一下体型吧', icon: 'none' })
      return
    }
    setSaving(true)
    try {
      const payload: BodyProfileData = {
        height_cm: height,
        weight_kg: weight,
        body_type: bodyShape,
        shoulder_type: shoulderType || undefined,
        leg_type: legType || undefined,
        skin_tone: skinTone || undefined,
        want_to_improve: improveAreas.length > 0 ? improveAreas : undefined,
      }
      await updateBodyProfile(payload)
      Taro.showToast({ title: '已保存', icon: 'success' })
    } catch {
      Taro.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  const saveStyle = async () => {
    setSaving(true)
    try {
      await api.patch('/users/me/preferences', {
        style_identity: styles,
        default_occasion: defaultOccasion,
        color_favorites: colorFavorites,
        temperature_sensitivity: tempSensitivity,
        variety_level: varietyLevel,
        avoid_repeat_days: avoidRepeatDays,
      })
      Taro.showToast({ title: '已保存', icon: 'success' })
    } catch {
      Taro.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  const handlePhotoUpload = async () => {
    try {
      const res = await Taro.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['camera', 'album'],
        sizeType: ['compressed'],
      })
      if (!res.tempFiles?.length) return

      setPhotoLoading(true)
      Taro.showLoading({ title: '上传中...' })
      const url = await uploadBodyPhoto(res.tempFiles[0].tempFilePath)
      setPhotoUrl(url)
      Taro.hideLoading()
      Taro.showToast({ title: '全身照已上传', icon: 'success' })
    } catch {
      Taro.hideLoading()
    } finally {
      setPhotoLoading(false)
    }
  }

  const toggleMulti = useCallback((list: string[], set: (v: string[]) => void, key: string, max?: number) => {
    if (list.includes(key)) {
      set(list.filter(k => k !== key))
    } else if (!max || list.length < max) {
      set([...list, key])
    }
  }, [])

  const toggleColor = useCallback((key: string) => {
    toggleMulti(colorFavorites, setColorFavorites, key, 5)
  }, [colorFavorites, toggleMulti])

  if (loading) {
    return (
      <View className='ps-page'>
        <View className='ps-loading'>
          <Text>加载中...</Text>
        </View>
      </View>
    )
  }

  return (
    <View className='ps-page'>
      {/* Tab Bar */}
      <View className='ps-tabs'>
        {TABS.map(tab => (
          <View
            key={tab.key}
            className={`ps-tab ${activeTab === tab.key ? 'ps-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <Text className='ps-tab-text'>{tab.label}</Text>
            {activeTab === tab.key && <View className='ps-tab-indicator' />}
          </View>
        ))}
      </View>

      <ScrollView className='ps-content' scrollY>
        {/* ===== Tab: Basic Info ===== */}
        {activeTab === 'basic' && (
          <View className='ps-section'>
            <View className='ps-group'>
              <Text className='ps-group-title'>性别</Text>
              <View className='ps-options'>
                {GENDER_OPTIONS.map(opt => (
                  <View
                    key={opt.key}
                    className={`ps-option ${gender === opt.key ? 'ps-option--active' : ''}`}
                    onClick={() => setGender(opt.key)}
                  >
                    <Text className='ps-option-text'>{opt.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View className='ps-group'>
              <Text className='ps-group-title'>年龄段</Text>
              <View className='ps-options'>
                {AGE_OPTIONS.map(opt => (
                  <View
                    key={opt.key}
                    className={`ps-option ${ageRange === opt.key ? 'ps-option--active' : ''}`}
                    onClick={() => setAgeRange(opt.key)}
                  >
                    <Text className='ps-option-text'>{opt.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View className='ps-group'>
              <Text className='ps-group-title'>职业场景</Text>
              <View className='ps-options'>
                {PROFESSION_OPTIONS.map(opt => (
                  <View
                    key={opt.key}
                    className={`ps-option ${profession === opt.key ? 'ps-option--active' : ''}`}
                    onClick={() => setProfession(opt.key)}
                  >
                    <Text className='ps-option-text'>{opt.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View className='ps-group'>
              <Text className='ps-group-title'>肤色</Text>
              <View className='ps-color-options'>
                {SKIN_TONE_OPTIONS.map(opt => (
                  <View
                    key={opt.key}
                    className={`ps-color-option ${skinTone === opt.key ? 'ps-color-option--active' : ''}`}
                    onClick={() => setSkinTone(opt.key)}
                  >
                    <View className='ps-color-swatch' style={{ backgroundColor: opt.color }} />
                    <Text className='ps-color-label'>{opt.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View className='ps-save-btn' onClick={saveBasic}>
              <Text className='ps-save-text'>{saving ? '保存中...' : '保存基本信息'}</Text>
            </View>
          </View>
        )}

        {/* ===== Tab: Body Data ===== */}
        {activeTab === 'body' && (
          <View className='ps-section'>
            {/* Photo */}
            <View className='ps-group'>
              <Text className='ps-group-title'>全身照</Text>
              <View className='ps-photo-area' onClick={handlePhotoUpload}>
                {photoUrl ? (
                  <Image className='ps-photo-img' src={resolveImageUrl(photoUrl) || ''} mode='aspectFit' />
                ) : (
                  <View className='ps-photo-placeholder'>
                    <Text className='ps-photo-icon'>📷</Text>
                    <Text className='ps-photo-hint'>上传全身照，解锁虚拟试衣</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Height & Weight */}
            <View className='ps-group'>
              <Text className='ps-group-title'>身高 {height}cm</Text>
              <Slider className='ps-slider' min={140} max={210} step={1} value={height} activeColor='#2D6A4F' onChanging={(e) => setHeight(e.detail.value)} />
            </View>

            <View className='ps-group'>
              <Text className='ps-group-title'>体重 {weight}kg</Text>
              <Slider className='ps-slider' min={35} max={150} step={1} value={weight} activeColor='#2D6A4F' onChanging={(e) => setWeight(e.detail.value)} />
            </View>

            {/* Body Shape */}
            <View className='ps-group'>
              <Text className='ps-group-title'>体型</Text>
              <View className='ps-options'>
                {BODY_SHAPE_OPTIONS.map(opt => (
                  <View
                    key={opt.key}
                    className={`ps-option ${bodyShape === opt.key ? 'ps-option--active' : ''}`}
                    onClick={() => setBodyShape(opt.key)}
                  >
                    <Text className='ps-option-text'>{opt.label}</Text>
                    <Text className='ps-option-desc'>{opt.desc}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Body Build */}
            <View className='ps-group'>
              <Text className='ps-group-title'>体格</Text>
              <View className='ps-options'>
                {BODY_BUILD_OPTIONS.map(opt => (
                  <View
                    key={opt.key}
                    className={`ps-option ${bodyBuild === opt.key ? 'ps-option--active' : ''}`}
                    onClick={() => setBodyBuild(opt.key)}
                  >
                    <Text className='ps-option-text'>{opt.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Shoulder */}
            <View className='ps-group'>
              <Text className='ps-group-title'>肩型</Text>
              <View className='ps-options'>
                {SHOULDER_OPTIONS.map(opt => (
                  <View
                    key={opt.key}
                    className={`ps-option ${shoulderType === opt.key ? 'ps-option--active' : ''}`}
                    onClick={() => setShoulderType(opt.key)}
                  >
                    <Text className='ps-option-text'>{opt.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Leg Type */}
            <View className='ps-group'>
              <Text className='ps-group-title'>腿型</Text>
              <View className='ps-options'>
                {LEG_TYPE_OPTIONS.map(opt => (
                  <View
                    key={opt.key}
                    className={`ps-option ${legType === opt.key ? 'ps-option--active' : ''}`}
                    onClick={() => setLegType(opt.key)}
                  >
                    <Text className='ps-option-text'>{opt.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Improve Areas */}
            <View className='ps-group'>
              <Text className='ps-group-title'>想改善的部位</Text>
              <View className='ps-options'>
                {IMPROVE_OPTIONS.map(opt => (
                  <View
                    key={opt.key}
                    className={`ps-option ${improveAreas.includes(opt.key) ? 'ps-option--active' : ''}`}
                    onClick={() => toggleMulti(improveAreas, setImproveAreas, opt.key)}
                  >
                    <Text className='ps-option-text'>{opt.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View className='ps-save-btn' onClick={saveBody}>
              <Text className='ps-save-text'>{saving ? '保存中...' : '保存身材数据'}</Text>
            </View>
          </View>
        )}

        {/* ===== Tab: Style Preferences ===== */}
        {activeTab === 'style' && (
          <View className='ps-section'>
            {/* Style Tags */}
            <View className='ps-group'>
              <Text className='ps-group-title'>风格偏好（最多5个）</Text>
              <View className='ps-options'>
                {STYLE_OPTIONS.map(opt => (
                  <View
                    key={opt.key}
                    className={`ps-option ${styles.includes(opt.key) ? 'ps-option--active' : ''}`}
                    onClick={() => toggleMulti(styles, setStyles, opt.key, 5)}
                  >
                    <Text className='ps-option-text'>{opt.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Default Occasion */}
            <View className='ps-group'>
              <Text className='ps-group-title'>默认场合</Text>
              <View className='ps-options'>
                {OCCASION_OPTIONS.map(opt => (
                  <View
                    key={opt.key}
                    className={`ps-option ${defaultOccasion === opt.key ? 'ps-option--active' : ''}`}
                    onClick={() => setDefaultOccasion(opt.key)}
                  >
                    <Text className='ps-option-text'>{opt.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Color Favorites */}
            <View className='ps-group'>
              <Text className='ps-group-title'>喜欢的颜色（最多5个）</Text>
              <View className='ps-color-grid'>
                {AVAILABLE_COLORS.map(colorKey => (
                  <View
                    key={colorKey}
                    className={`ps-color-chip ${colorFavorites.includes(colorKey) ? 'ps-color-chip--active' : ''}`}
                    onClick={() => toggleColor(colorKey)}
                  >
                    <View className='ps-color-circle' style={{ backgroundColor: COLOR_MAP[colorKey] }} />
                    <Text className='ps-color-name'>{COLOR_LABELS_CN[colorKey] || colorKey}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Temperature Sensitivity */}
            <View className='ps-group'>
              <Text className='ps-group-title'>温度敏感度</Text>
              <View className='ps-options'>
                {TEMP_SENSITIVITY.map(opt => (
                  <View
                    key={opt.key}
                    className={`ps-option ${tempSensitivity === opt.key ? 'ps-option--active' : ''}`}
                    onClick={() => setTempSensitivity(opt.key)}
                  >
                    <Text className='ps-option-text'>{opt.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Variety Level */}
            <View className='ps-group'>
              <Text className='ps-group-title'>穿搭多样性</Text>
              <View className='ps-options'>
                {VARIETY_LEVELS.map(opt => (
                  <View
                    key={opt.key}
                    className={`ps-option ${varietyLevel === opt.key ? 'ps-option--active' : ''}`}
                    onClick={() => setVarietyLevel(opt.key)}
                  >
                    <Text className='ps-option-text'>{opt.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Avoid Repeat Days */}
            <View className='ps-group'>
              <Text className='ps-group-title'>避免重复穿搭天数</Text>
              <View className='ps-options'>
                {[3, 5, 7, 14].map(d => (
                  <View
                    key={d}
                    className={`ps-option ${avoidRepeatDays === d ? 'ps-option--active' : ''}`}
                    onClick={() => setAvoidRepeatDays(d)}
                  >
                    <Text className='ps-option-text'>{d}天</Text>
                  </View>
                ))}
              </View>
            </View>

            <View className='ps-save-btn' onClick={saveStyle}>
              <Text className='ps-save-text'>{saving ? '保存中...' : '保存风格偏好'}</Text>
            </View>
          </View>
        )}

        <View style={{ height: '120rpx' }} />
      </ScrollView>
    </View>
  )
}
