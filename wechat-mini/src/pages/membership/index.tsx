import { View, Text, Image} from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import './index.scss'
import { icons } from '../../constants/icons'

const PLANS = [
  { key: 'free', label: '免费版', price: '¥0', period: '永久', features: ['每日3次AI搭配', '基础衣橱管理', '天气穿搭推荐'], highlight: false },
  { key: 'monthly', label: '月度会员', price: '¥19.9', period: '/月', features: ['无限AI搭配', 'AI批量解析', '穿搭评测', '高级统计'], highlight: false },
  { key: 'permanent', label: '永久会员', price: '¥99', period: '一次性', features: ['所有月度权益', '赠100AI点数', '专属客服', '优先体验新功能'], highlight: true },
]

export default function MembershipPage() {
  const [selected, setSelected] = useState('permanent')

  const handleSubscribe = (plan: string) => {
    if (plan === 'free') {
      Taro.navigateBack()
      return
    }
    Taro.showModal({
      title: '即将开放',
      content: '支付功能正在对接微信支付，预计很快上线。你可以先免费体验基础功能！',
      showCancel: false,
      confirmText: '知道了',
    })
  }

  return (
    <View className='membership-page'>

      {/* Hero */}
      <View className='membership-hero'>
        <Image src={icons['crown']} className='membership-hero-icon' style={{width: '48rpx', height: '48rpx'}} />
        <Text className='membership-hero-title'>解锁无限AI搭配</Text>
        <Text className='membership-hero-sub'>让AI成为你的私人造型师</Text>
      </View>

      {/* Current Status */}
      <View className='membership-current'>
        <View className='membership-current-badge'>
          <Text className='membership-current-badge-text'>免费版</Text>
        </View>
        <Text className='membership-current-desc'>升级会员解锁更多 AI 功能</Text>
      </View>

      {/* Benefits */}
      <View className='membership-benefits'>
        <Text className='membership-benefits-title'>会员权益</Text>
        <View className='membership-benefits-grid'>
          {[
            { icon: icons['bot'], label: '无限AI搭配' },
            { icon: icons['clipboard-list'], label: 'AI批量解析' },
            { icon: icons['pencil'], label: '穿搭评测' },
            { icon: icons['bar-chart-3'], label: '高级统计' },
            { icon: icons['target'], label: '精准推荐' },
            { icon: icons['message-circle'], label: '专属客服' },
          ].map((b, idx) => (
            <View key={idx} className='membership-benefit-item'>
              <Image src={b.icon} className='membership-benefit-icon' style={{width: '48rpx', height: '48rpx'}} />
              <Text className='membership-benefit-label'>{b.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Plans */}
      <View className='membership-plans'>
        {PLANS.map(plan => (
          <View
            key={plan.key}
            className={`membership-plan ${plan.highlight ? 'membership-plan--highlight' : ''} ${selected === plan.key ? 'membership-plan--selected' : ''}`}
            onClick={() => setSelected(plan.key)}
          >
            {plan.highlight && <View className='membership-plan-badge'><Text className='membership-plan-badge-text'>推荐</Text></View>}
            <Text className='membership-plan-label'>{plan.label}</Text>
            <View className='membership-plan-price-row'>
              <Text className='membership-plan-price'>{plan.price}</Text>
              <Text className='membership-plan-period'>{plan.period}</Text>
            </View>
            <View className='membership-plan-features'>
              {plan.features.map((f, idx) => (
                <View key={idx} className='membership-plan-feature'>
                  <Image src={icons['check']} className='membership-plan-check' style={{width: '48rpx', height: '48rpx'}} />
                  <Text className='membership-plan-feature-text'>{f}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>

      {/* Subscribe Button */}
      <View className='membership-subscribe' onClick={() => handleSubscribe(selected)}>
        <Text className='membership-subscribe-text'>
          {selected === 'free' ? '继续使用免费版' : `立即开通 ${PLANS.find(p => p.key === selected)?.price}`}
        </Text>
      </View>

      {/* Free Features */}
      <View className='membership-free-features'>
        <Text className='membership-free-title'>免费版已包含</Text>
        <View className='membership-free-list'>
          {['衣橱管理（无限衣物）', 'AI 衣物识别', '每日 3 次 AI 搭配', '天气穿搭推荐', '穿搭日记记录'].map((f, i) => (
            <View key={i} className='membership-free-item'>
              <Image src={icons['check']} className='membership-free-check' style={{width: '48rpx', height: '48rpx'}} />
              <Text className='membership-free-text'>{f}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Terms */}
      <View className='membership-terms'>
        <Text className='membership-terms-text'>开通即表示同意《会员服务协议》</Text>
      </View>
    </View>
  )
}