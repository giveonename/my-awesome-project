import { View, Text, Slider, Image} from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import { api } from '../../utils/api'
import './index.scss'
import { icons } from '../../constants/icons'

const GENDER_OPTIONS = [
  { key: 'male', label: '男', icon: icons['user'] },
  { key: 'female', label: '女', icon: icons['user'] },
  { key: 'non-binary', label: '其他', icon: icons['user'] },
  { key: 'prefer-not-to-say', label: '不想说', icon: icons['lock'] },
]

const AGE_OPTIONS = [
  { key: '18-24', label: '18-24' },
  { key: '25-30', label: '25-30' },
  { key: '31-40', label: '31-40' },
  { key: '40+', label: '40+' },
]

const BODY_TYPE_OPTIONS = [
  { key: 'slim', label: '偏瘦', icon: icons['activity'] },
  { key: 'standard', label: '标准', icon: icons['user'] },
  { key: 'athletic', label: '健硕', icon: icons['zap'] },
  { key: 'curvy', label: '丰满', icon: icons['heart'] },
  { key: 'muscular', label: '壮实', icon: icons['zap'] },
]

const STYLE_OPTIONS = [
  { key: 'casual', label: '休闲', icon: icons['glasses'] },
  { key: 'office', label: '通勤', icon: icons['briefcase'] },
  { key: 'sporty', label: '运动', icon: icons['activity'] },
  { key: 'minimalist', label: '极简', icon: icons['heart'] },
  { key: 'artistic', label: '文艺', icon: icons['leaf'] },
  { key: 'streetwear', label: '潮流', icon: icons['flame'] },
  { key: 'elegant', label: '精致', icon: icons['crown'] },
  { key: 'bold', label: '大胆', icon: icons['rainbow'] },
]

const CONCERN_OPTIONS = [
  { key: 'look-taller', label: '显高' },
  { key: 'look-slimmer', label: '显瘦' },
  { key: 'hide-belly', label: '遮肉' },
  { key: 'longer-legs', label: '显腿长' },
  { key: 'wider-shoulders', label: '显肩宽' },
  { key: 'none', label: '无所谓' },
]

const PROFESSION_OPTIONS = [
  { key: 'student', label: '学生', icon: icons['graduation-cap'] },
  { key: 'office', label: '上班族', icon: icons['building'] },
  { key: 'freelance', label: '自由职业', icon: icons['laptop'] },
  { key: 'entrepreneur', label: '创业者', icon: icons['rocket'] },
  { key: 'other', label: '其他', icon: icons['sparkles'] },
]

export default function OnboardingPage() {
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)

  // Step 1 data
  const [gender, setGender] = useState('')
  const [ageRange, setAgeRange] = useState('')

  // Step 2 data
  const [height, setHeight] = useState(170)
  const [weight, setWeight] = useState(60)
  const [bodyType, setBodyType] = useState('')

  // Step 3 data
  const [styles, setStyles] = useState<string[]>([])
  const [concerns, setConcerns] = useState<string[]>([])
  const [profession, setProfession] = useState('')

  const toggleMultiSelect = (list: string[], setList: (v: string[]) => void, key: string, max: number = 5) => {
    if (list.includes(key)) {
      setList(list.filter(k => k !== key))
    } else if (list.length < max) {
      setList([...list, key])
    }
  }

  const saveStep = async (stepNum: number, data: Record<string, unknown>) => {
    setSaving(true)
    try {
      await api.post('/chat/onboarding', { step: stepNum, data })
      if (stepNum < 3) {
        setStep(stepNum + 1)
      } else {
        Taro.switchTab({ url: '/pages/home/index' })
      }
    } catch (err) {
      console.error('Onboarding save failed:', err)
      Taro.showToast({ title: '没保存上，再试一次？', icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  const handleStep1 = () => {
    if (!gender || !ageRange) {
      Taro.showToast({ title: '选一下性别和年龄段吧', icon: 'none' })
      return
    }
    saveStep(1, { gender, age_range: ageRange })
  }

  const handleStep2 = () => {
    if (!bodyType) {
      Taro.showToast({ title: '选一下体型吧', icon: 'none' })
      return
    }
    saveStep(2, { height_cm: height, weight_kg: weight, body_type: bodyType })
  }

  const handleStep3 = () => {
    if (styles.length === 0) {
      Taro.showToast({ title: '至少选一个风格哦', icon: 'none' })
      return
    }
    if (!profession) {
      Taro.showToast({ title: '选一下职业场景吧', icon: 'none' })
      return
    }
    saveStep(3, {
      style_identity: styles,
      body_concerns: concerns.filter(c => c !== 'none'),
      profession_scene: profession,
    })
  }

  const renderStep1 = () => (
    <View className='onboard-step'>
      <View className='onboard-header'>
        <Image src={icons['hand']} className='onboard-emoji' style={{width: '48rpx', height: '48rpx'}} />
        <Text className='onboard-title'>欢迎来到 Wardrowbe</Text>
        <Text className='onboard-subtitle'>先简单了解一下你～</Text>
      </View>

      <View className='onboard-section'>
        <Text className='onboard-label'>性别</Text>
        <View className='option-grid'>
          {GENDER_OPTIONS.map(opt => (
            <View
              key={opt.key}
              className={`option-card ${gender === opt.key ? 'option-card--active' : ''}`}
              onClick={() => setGender(opt.key)}
            >
              <Image src={opt.icon} className='option-card-icon' style={{width: '48rpx', height: '48rpx'}} />
              <Text className='option-card-label'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View className='onboard-section'>
        <Text className='onboard-label'>年龄段</Text>
        <View className='chip-grid'>
          {AGE_OPTIONS.map(opt => (
            <View
              key={opt.key}
              className={`chip ${ageRange === opt.key ? 'chip--active' : ''}`}
              onClick={() => setAgeRange(opt.key)}
            >
              <Text className='chip-text'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View className='onboard-actions'>
        <View className={`onboard-btn ${saving ? 'onboard-btn--loading' : ''}`} onClick={handleStep1}>
          <Text className='onboard-btn-text'>{saving ? '保存中...' : '下一步 →'}</Text>
        </View>
      </View>
    </View>
  )

  const renderStep2 = () => (
    <View className='onboard-step'>
      <View className='onboard-header'>
        <Image src={icons['ruler']} className='onboard-emoji' style={{width: '48rpx', height: '48rpx'}} />
        <Text className='onboard-title'>身材信息</Text>
        <Text className='onboard-subtitle'>用于更精准的穿搭推荐</Text>
      </View>

      <View className='onboard-section'>
        <Text className='onboard-label'>身高：{height} cm</Text>
        <View className='slider-wrap'>
          <Slider
            className='onboard-slider'
            min={140}
            max={210}
            step={1}
            value={height}
            activeColor='#ffffff'
            backgroundColor='rgba(255,255,255,0.3)'
            blockColor='#ffffff'
            blockSize={24}
            onChange={(e) => setHeight(e.detail.value)}
          />
          <View className='slider-range'>
            <Text className='slider-min'>140cm</Text>
            <Text className='slider-max'>210cm</Text>
          </View>
        </View>
      </View>

      <View className='onboard-section'>
        <Text className='onboard-label'>体重：{weight} kg</Text>
        <View className='slider-wrap'>
          <Slider
            className='onboard-slider'
            min={35}
            max={150}
            step={1}
            value={weight}
            activeColor='#ffffff'
            backgroundColor='rgba(255,255,255,0.3)'
            blockColor='#ffffff'
            blockSize={24}
            onChange={(e) => setWeight(e.detail.value)}
          />
          <View className='slider-range'>
            <Text className='slider-min'>35kg</Text>
            <Text className='slider-max'>150kg</Text>
          </View>
        </View>
      </View>

      <View className='onboard-section'>
        <Text className='onboard-label'>体型</Text>
        <View className='option-grid'>
          {BODY_TYPE_OPTIONS.map(opt => (
            <View
              key={opt.key}
              className={`option-card ${bodyType === opt.key ? 'option-card--active' : ''}`}
              onClick={() => setBodyType(opt.key)}
            >
              <Image src={opt.icon} className='option-card-icon' style={{width: '48rpx', height: '48rpx'}} />
              <Text className='option-card-label'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View className='onboard-actions'>
        <View className='onboard-btn onboard-btn--secondary' onClick={() => setStep(1)}>
          <Text className='onboard-btn-text'>← 上一步</Text>
        </View>
        <View className={`onboard-btn ${saving ? 'onboard-btn--loading' : ''}`} onClick={handleStep2}>
          <Text className='onboard-btn-text'>{saving ? '保存中...' : '下一步 →'}</Text>
        </View>
      </View>
    </View>
  )

  const renderStep3 = () => (
    <View className='onboard-step'>
      <View className='onboard-header'>
        <Image src={icons['palette']} className='onboard-emoji' style={{width: '48rpx', height: '48rpx'}} />
        <Text className='onboard-title'>你的穿搭风格</Text>
        <Text className='onboard-subtitle'>选择你认同的风格标签</Text>
      </View>

      <View className='onboard-section'>
        <Text className='onboard-label'>风格偏好（选 1-5 个）</Text>
        <View className='option-grid'>
          {STYLE_OPTIONS.map(opt => (
            <View
              key={opt.key}
              className={`option-card ${styles.includes(opt.key) ? 'option-card--active' : ''}`}
              onClick={() => toggleMultiSelect(styles, setStyles, opt.key)}
            >
              <Image src={opt.icon} className='option-card-icon' style={{width: '48rpx', height: '48rpx'}} />
              <Text className='option-card-label'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View className='onboard-section'>
        <Text className='onboard-label'>身材关注点（可多选）</Text>
        <View className='chip-grid'>
          {CONCERN_OPTIONS.map(opt => (
            <View
              key={opt.key}
              className={`chip ${concerns.includes(opt.key) ? 'chip--active' : ''}`}
              onClick={() => toggleMultiSelect(concerns, setConcerns, opt.key, 6)}
            >
              <Text className='chip-text'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View className='onboard-section'>
        <Text className='onboard-label'>职业场景</Text>
        <View className='option-grid'>
          {PROFESSION_OPTIONS.map(opt => (
            <View
              key={opt.key}
              className={`option-card ${profession === opt.key ? 'option-card--active' : ''}`}
              onClick={() => setProfession(opt.key)}
            >
              <Image src={opt.icon} className='option-card-icon' style={{width: '48rpx', height: '48rpx'}} />
              <Text className='option-card-label'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View className='onboard-actions'>
        <View className='onboard-btn onboard-btn--secondary' onClick={() => setStep(2)}>
          <Text className='onboard-btn-text'>← 上一步</Text>
        </View>
        <View className={`onboard-btn ${saving ? 'onboard-btn--loading' : ''}`} onClick={handleStep3}>
          <Text className='onboard-btn-text'>{saving ? '保存中...' : '完成'}</Text>
        </View>
      </View>
    </View>
  )

  return (
    <View className='onboarding-page'>
      {/* Progress indicator */}
      <View className='onboard-progress'>
        <View className='progress-bar'>
          <View className='progress-fill' style={{ width: `${(step / 3) * 100}%` }} />
        </View>
        <Text className='progress-text'>第 {step} 步 / 共 3 步</Text>
      </View>

      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && renderStep3()}
    </View>
  )
}