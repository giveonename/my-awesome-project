import { View, Text, Image} from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useEffect } from 'react'
import { api, setAccessToken, ApiError } from '../../utils/api'
import './index.scss'
import { icons } from '../../constants/icons'

interface WeChatLoginResponse {
  id: string
  email: string
  display_name: string
  is_new_user: boolean
  onboarding_completed: boolean
  access_token: string
}

const FEATURES = [
  { icon: icons['camera'], title: '拍照识衣', desc: 'AI 一键识别，秒入库' },
  { icon: icons['shirt'], title: '虚拟试穿', desc: '穿搭照即刻上身' },
  { icon: icons['bot'], title: 'AI 造型师', desc: '对话式穿搭灵感' },
  { icon: icons['cloud-sun'], title: '天气感知', desc: '出门穿搭不纠结' },
]

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [retryCount, setRetryCount] = useState(0)
  const [animReady, setAnimReady] = useState(false)

  useEffect(() => {
    // Trigger entrance animation after mount
    setTimeout(() => setAnimReady(true), 100)
  }, [])

  const handleLogin = async () => {
    setLoading(true)
    setError('')

    try {
      const loginRes = await Taro.login()
      if (!loginRes.code) {
        setError('登录凭证获取失败，再试一次')
        setLoading(false)
        return
      }

      const result = await api.post<WeChatLoginResponse>('/auth/wechat/login', {
        code: loginRes.code,
      })

      setAccessToken(result.access_token)

      // Fire-and-forget push token (not all Taro versions support this)
      try {
        const pushRes = await (Taro as any).getPushClientId?.()
        if (pushRes?.cid) {
          api.post('/notifications/push-token', { push_token: pushRes.cid }).catch(() => {})
        }
      } catch {
        // Push not available in this Taro version
      }

      if (!result.onboarding_completed) {
        Taro.redirectTo({ url: '/pages/onboarding/index' })
      } else {
        Taro.switchTab({ url: '/pages/home/index' })
      }
    } catch (err: unknown) {
      console.error('Login failed:', err)
      const message = err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : '登录没成功，再试一次？'
      setError(message)
      setRetryCount(prev => prev + 1)
    } finally {
      setLoading(false)
    }
  }

  return (
    <View className={`login-page ${animReady ? 'login-page--ready' : ''}`}>
      {/* Brand header */}
      <View className='login-brand'>
        <View className='login-logo-wrap'>
          <Image src={icons['sparkles']} className='login-logo-icon' style={{width: '48rpx', height: '48rpx'}} />
        </View>
        <Text className='login-brand-name'>魔搭幻穿</Text>
        <Text className='login-brand-tagline'>你的 AI 智能穿搭管家</Text>
      </View>

      {/* Feature grid */}
      <View className='login-features'>
        {FEATURES.map((feat, idx) => (
          <View
            key={feat.title}
            className='login-feature-card'
            style={{ animationDelay: `${300 + idx * 100}ms` }}
          >
            <Image src={feat.icon} className='login-feature-icon' style={{width: '48rpx', height: '48rpx'}} />
            <View className='login-feature-text'>
              <Text className='login-feature-title'>{feat.title}</Text>
              <Text className='login-feature-desc'>{feat.desc}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* CTA */}
      <View className='login-cta'>
        {error ? (
          <View className='login-error'>
            <Text className='login-error-text'>{error}</Text>
          </View>
        ) : null}

        <View
          className={`login-btn ${loading ? 'login-btn--loading' : ''}`}
          onClick={!loading ? handleLogin : undefined}
        >
          <View className='login-btn-inner'>
            {loading ? (
              <View className='login-btn-spinner' />
            ) : null}
            <Text className='login-btn-text'>
              {loading
                ? '登录中...'
                : retryCount > 0
                  ? '重新登录'
                  : '微信一键登录'}
            </Text>
          </View>
        </View>

        <Text className='login-footer'>
          登录即代表同意《用户协议》和《隐私政策》
        </Text>
      </View>
    </View>
  )
}

