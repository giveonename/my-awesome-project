import { View, Text, Slider, Image} from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState, useCallback } from 'react'
import { getBodyProfile, updateBodyProfile, BodyProfileData, getBodyPhoto, uploadBodyPhoto, resolveImageUrl } from '../../utils/api'
import './index.scss'
import { icons } from '../../constants/icons'

// ===== Options =====

const BODY_TYPE_OPTIONS = [
  { key: 'hourglass', label: '沙漏型', icon: '⌛', desc: '肩胯等宽，腰细' },
  { key: 'pear', label: '梨形', icon: icons['circle'], desc: '胯宽于肩' },
  { key: 'apple', label: '苹果型', icon: icons['apple'], desc: '腰腹较圆润' },
  { key: 'rectangle', label: '矩形', icon: icons['ruler'], desc: '肩腰胯等宽' },
  { key: 'inverted-triangle', label: '倒三角', icon: icons['arrow-down'], desc: '肩宽于胯' },
]

const SKIN_TONE_OPTIONS = [
  { key: 'fair', label: '白皙', color: '#FDEBD0' },
  { key: 'light', label: '偏白', color: '#F5CBA7' },
  { key: 'medium', label: '自然', color: '#E8B88A' },
  { key: 'tan', label: '小麦', color: '#D4A574' },
  { key: 'dark', label: '健康', color: '#C0956E' },
]

const WANT_IMPROVE_OPTIONS = [
  { key: 'look-taller', label: '显高' },
  { key: 'look-slimmer', label: '显瘦' },
  { key: 'hide-belly', label: '遮肚子' },
  { key: 'longer-legs', label: '显腿长' },
  { key: 'wider-shoulders', label: '显肩宽' },
  { key: 'slim-arms', label: '显手臂细' },
  { key: 'hide-hips', label: '遮胯' },
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

// ===== Default profile =====

const DEFAULT_PROFILE: Required<BodyProfileData> = {
  height_cm: 170,
  weight_kg: 60,
  body_type: '',
  shoulder_type: '',
  leg_type: '',
  upper_lower_ratio: '',
  bust_cm: null,
  waist_cm: null,
  hip_cm: null,
  skin_tone: '',
  want_to_improve: [],
  extra: null,
}

// ===== Component =====

export default function BodyProfilePage() {
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<Required<BodyProfileData>>(DEFAULT_PROFILE)
  const [photoUrl, setPhotoUrl] = useState('')
  const [photoLoading, setPhotoLoading] = useState(false)

  useDidShow(() => {
    loadProfile()
    loadPhoto()
  })

  const loadProfile = async () => {
    setLoading(true)
    try {
      const data = await getBodyProfile()
      if (data.body_type) {
        // Profile exists, populate form
        setProfile({
          height_cm: data.height_cm ?? 170,
          weight_kg: data.weight_kg ?? 60,
          body_type: data.body_type ?? '',
          shoulder_type: data.shoulder_type ?? '',
          leg_type: data.leg_type ?? '',
          upper_lower_ratio: data.upper_lower_ratio ?? '',
          bust_cm: data.bust_cm ?? null,
          waist_cm: data.waist_cm ?? null,
          hip_cm: data.hip_cm ?? null,
          skin_tone: data.skin_tone ?? '',
          want_to_improve: data.want_to_improve ?? [],
          extra: data.extra ?? null,
        })
      }
    } catch {
      // No profile yet, use defaults
    } finally {
      setLoading(false)
    }
  }

  const loadPhoto = async () => {
    try {
      const res = await getBodyPhoto()
      setPhotoUrl(res?.photo_url || '')
    } catch {
      setPhotoUrl('')
    }
  }

  const handleChoosePhoto = useCallback(async () => {
    try {
      const res = await Taro.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['camera', 'album'],
        sizeType: ['compressed'],
      })
      if (!res.tempFiles?.length) return
      setPhotoLoading(true)
      const filePath = res.tempFiles[0].tempFilePath
      const uploadRes = await uploadBodyPhoto(filePath)
      setPhotoUrl(uploadRes.photo_url || '')
      Taro.showToast({ title: '全身照已更新', icon: 'success' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '上传失败，稍后再试'
      Taro.showToast({ title: msg, icon: 'none' })
    } finally {
      setPhotoLoading(false)
    }
  }, [])

  // Centralized update function
  const update = useCallback((patch: Partial<BodyProfileData>) => {
    setProfile(prev => ({ ...prev, ...patch }))
  }, [])

  const toggleWantImprove = useCallback((key: string) => {
    setProfile(prev => {
      const current = prev.want_to_improve || []
      const next = current.includes(key)
        ? current.filter(k => k !== key)
        : [...current, key]
      return { ...prev, want_to_improve: next }
    })
  }, [])

  const handleSave = async () => {
    if (!profile.body_type) {
      Taro.showToast({ title: '选一下体型吧', icon: 'none' })
      return
    }

    setSaving(true)
    try {
      const payload: BodyProfileData = {
        height_cm: profile.height_cm,
        weight_kg: profile.weight_kg,
        body_type: profile.body_type,
        shoulder_type: profile.shoulder_type || undefined,
        leg_type: profile.leg_type || undefined,
        upper_lower_ratio: profile.upper_lower_ratio || undefined,
        bust_cm: profile.bust_cm || undefined,
        waist_cm: profile.waist_cm || undefined,
        hip_cm: profile.hip_cm || undefined,
        skin_tone: profile.skin_tone || undefined,
        want_to_improve: profile.want_to_improve?.length ? profile.want_to_improve : undefined,
      }

      await updateBodyProfile(payload)
      Taro.showToast({ title: '身材档案保存好了', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 1200)
    } catch (err) {
      console.error('Save body profile failed:', err)
      Taro.showToast({ title: '没保存上，再试一次？', icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  // ===== Step 1: Basic =====
  const renderStep1 = () => (
    <View className='bp-step animate-fade-in-up'>
      <View className='bp-card'>
        <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['camera']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='bp-card-title'>数字分身全身照</Text></View>
        <Text className='bp-card-desc'>上传一张光线充足、正面站立的全身照，试穿效果更真实</Text>
        <View className='bp-photo-area'>
          {photoUrl ? (
            <Image className='bp-photo-preview' src={resolveImageUrl(photoUrl) || photoUrl} mode='aspectFill' />
          ) : (
            <View className='bp-photo-placeholder'>
              <Image src={icons['camera']} style={{width: '48rpx', height: '48rpx', marginBottom: '12rpx'}} />
              <Text className='bp-photo-placeholder-title'>上传全身照</Text>
              <Text className='bp-photo-placeholder-desc'>建议穿着修身服装，背景简洁</Text>
            </View>
          )}
        </View>
        <View className={`bp-btn bp-btn--primary press-scale ${photoLoading ? 'bp-btn--loading' : ''}`} style={{marginTop: '20rpx'}} onClick={handleChoosePhoto}>
          <Text className='bp-btn-text'>{photoUrl ? (photoLoading ? '重新上传中...' : '重新上传照片') : (photoLoading ? '上传中...' : '上传照片')}</Text>
        </View>
      </View>

      <View className='bp-card'>
        <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['ruler']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='bp-card-title'>身高体重</Text></View>

        <View className='bp-section'>
          <View className='bp-value-display'>
            <Text className='bp-value-num'>{profile.height_cm}</Text>
            <Text className='bp-value-unit'>cm</Text>
          </View>
          <Slider
            className='bp-slider'
            min={140}
            max={210}
            step={1}
            value={profile.height_cm as number}
            activeColor='#5E9C82'
            backgroundColor='#EDF5EF'
            blockColor='#5E9C82'
            blockSize={28}
            onChange={(e) => update({ height_cm: e.detail.value })}
          />
          <View className='bp-slider-range'>
            <Text className='bp-slider-label'>140cm</Text>
            <Text className='bp-slider-label'>210cm</Text>
          </View>
        </View>

        <View className='bp-divider' />

        <View className='bp-section'>
          <View className='bp-value-display'>
            <Text className='bp-value-num'>{profile.weight_kg}</Text>
            <Text className='bp-value-unit'>kg</Text>
          </View>
          <Slider
            className='bp-slider'
            min={35}
            max={150}
            step={1}
            value={profile.weight_kg as number}
            activeColor='#5E9C82'
            backgroundColor='#EDF5EF'
            blockColor='#5E9C82'
            blockSize={28}
            onChange={(e) => update({ weight_kg: e.detail.value })}
          />
          <View className='bp-slider-range'>
            <Text className='bp-slider-label'>35kg</Text>
            <Text className='bp-slider-label'>150kg</Text>
          </View>
        </View>
      </View>
    </View>
  )

  // ===== Step 2: Body Shape =====
  const renderStep2 = () => (
    <View className='bp-step animate-fade-in-up'>
      <View className='bp-card'>
        <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['apple']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='bp-card-title'>你的身型</Text></View>
        <Text className='bp-card-desc'>选一个最接近的，AI 据此推荐最显身材的搭配</Text>
        <View className='bp-grid'>
          {BODY_TYPE_OPTIONS.map(opt => (
            <View
              key={opt.key}
              className={`bp-option ${profile.body_type === opt.key ? 'bp-option--active' : ''}`}
              onClick={() => update({ body_type: opt.key })}
            >
              <Image src={opt.icon} className='bp-option-icon' style={{width: '48rpx', height: '48rpx'}} />
              <Text className='bp-option-label'>{opt.label}</Text>
              <Text className='bp-option-desc'>{opt.desc}</Text>
            </View>
          ))}
        </View>
      </View>

      <View className='bp-card'>
        <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['shirt']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='bp-card-title'>体型细节（可选）</Text></View>

        <View className='bp-section'>
          <Text className='bp-label'>肩型</Text>
          <View className='bp-chip-row'>
            {SHOULDER_OPTIONS.map(opt => (
              <View
                key={opt.key}
                className={`bp-chip ${profile.shoulder_type === opt.key ? 'bp-chip--active' : ''}`}
                onClick={() => update({ shoulder_type: opt.key })}
              >
                <Text className='bp-chip-text'>{opt.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View className='bp-section'>
          <Text className='bp-label'>腿型</Text>
          <View className='bp-chip-row'>
            {LEG_TYPE_OPTIONS.map(opt => (
              <View
                key={opt.key}
                className={`bp-chip ${profile.leg_type === opt.key ? 'bp-chip--active' : ''}`}
                onClick={() => update({ leg_type: opt.key })}
              >
                <Text className='bp-chip-text'>{opt.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View className='bp-section'>
          <Text className='bp-label'>上下身比例</Text>
          <View className='bp-chip-row'>
            {[
              { key: 'long-torso', label: '上身长' },
              { key: 'balanced', label: '标准' },
              { key: 'long-legs', label: '腿长' },
            ].map(opt => (
              <View
                key={opt.key}
                className={`bp-chip ${profile.upper_lower_ratio === opt.key ? 'bp-chip--active' : ''}`}
                onClick={() => update({ upper_lower_ratio: opt.key })}
              >
                <Text className='bp-chip-text'>{opt.label}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    </View>
  )

  // ===== Step 3: Skin & Goals =====
  const renderStep3 = () => (
    <View className='bp-step animate-fade-in-up'>
      <View className='bp-card'>
        <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['palette']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='bp-card-title'>肤色</Text></View>
        <Text className='bp-card-desc'>选一个最接近的肤色，帮你避开显黑的颜色</Text>
        <View className='bp-skin-row'>
          {SKIN_TONE_OPTIONS.map(opt => (
            <View
              key={opt.key}
              className={`bp-skin-item ${profile.skin_tone === opt.key ? 'bp-skin-item--active' : ''}`}
              onClick={() => update({ skin_tone: opt.key })}
            >
              <View className='bp-skin-circle' style={{ backgroundColor: opt.color }} />
              <Text className='bp-skin-label'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View className='bp-card'>
        <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['sparkles']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='bp-card-title'>想修饰的部位</Text></View>
        <Text className='bp-card-desc'>选好了 AI 会重点推荐显瘦显高的搭配方案</Text>
        <View className='bp-chip-row bp-chip-wrap'>
          {WANT_IMPROVE_OPTIONS.map(opt => (
            <View
              key={opt.key}
              className={`bp-chip ${(profile.want_to_improve || []).includes(opt.key) ? 'bp-chip--active' : ''}`}
              onClick={() => toggleWantImprove(opt.key)}
            >
              <Text className='bp-chip-text'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View className='bp-tip'>
        <Image src={icons['lightbulb']} className='bp-tip-icon' style={{width: '48rpx', height: '48rpx'}} />
        <Text className='bp-tip-text'>档案越详细，AI 推荐越精准。这些信息只有你自己能看到</Text>
      </View>
    </View>
  )

  // ===== Loading =====
  if (loading) {
    return (
      <View className='body-profile-page'>
        <View className='bp-loading'>
          <Text className='bp-loading-text'>正在加载档案...</Text>
        </View>
      </View>
    )
  }

  return (
    <View className='body-profile-page'>

      {/* Progress */}
      <View className='bp-progress'>
        <View className='bp-progress-bar'>
          <View className='bp-progress-fill' style={{ width: `${(step / 3) * 100}%` }} />
        </View>
        <Text className='bp-progress-text'>第 {step} 步 / 共 3 步</Text>
      </View>

      {/* Step Content */}
      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && renderStep3()}

      {/* Actions */}
      <View className='bp-actions'>
        {step > 1 && (
          <View className='bp-btn bp-btn--secondary press-scale' onClick={() => setStep(step - 1)}>
            <Text className='bp-btn-text'>上一步</Text>
          </View>
        )}
        {step < 3 ? (
          <View className='bp-btn bp-btn--primary press-scale' onClick={() => setStep(step + 1)}>
            <Text className='bp-btn-text'>下一步</Text>
          </View>
        ) : (
          <View className={`bp-btn bp-btn--primary press-scale ${saving ? 'bp-btn--loading' : ''}`} onClick={handleSave}>
            <Text className='bp-btn-text'>{saving ? '保存中...' : '保存身材档案'}</Text>
          </View>
        )}
      </View>
    </View>
  )
}
