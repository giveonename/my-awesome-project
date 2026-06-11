import { View, Text, Image } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState, useCallback } from 'react'
import './index.scss'
import { icons } from '../../constants/icons'

interface TabItem {
  key: string
  text: string
  icon: string
  selectedIcon: string
  pagePath: string
}

const TABS: TabItem[] = [
  { key: 'home',     text: '首页', icon: 'building', selectedIcon: 'building', pagePath: '/pages/home/index' },
  { key: 'wardrobe', text: '衣橱', icon: 'shirt', selectedIcon: 'shirt', pagePath: '/pages/wardrobe/index' },
  { key: 'suggest',  text: '搭配', icon: 'sparkles', selectedIcon: 'sparkles', pagePath: '/pages/suggest/index' },
  { key: 'profile',  text: '我的', icon: 'user', selectedIcon: 'user', pagePath: '/pages/profile/index' },
]

export default function CustomTabBar() {
  const [selected, setSelected] = useState(0)
  const [animatingIdx, setAnimatingIdx] = useState<number | null>(null)

  // Detect current page on each show
  useDidShow(() => {
    const pages = Taro.getCurrentPages()
    const current = pages[pages.length - 1]
    if (current) {
      const route = '/' + current.route
      const idx = TABS.findIndex(t => route.includes(t.key))
      if (idx >= 0) setSelected(idx)
    }
  })

  const handleTabClick = useCallback((index: number) => {
    const tab = TABS[index]
    if (!tab) return

    // Trigger bounce animation
    setAnimatingIdx(index)
    setTimeout(() => setAnimatingIdx(null), 300)

    // Navigate after brief delay for animation feel
    setTimeout(() => {
      Taro.switchTab({ url: tab.pagePath })
    }, 120)
  }, [])

  const handleAddClick = useCallback(() => {
    // Navigate to parse page (unified upload)
    Taro.navigateTo({ url: '/pages/parse/index' })
  }, [])

  return (
    <View className='custom-tabbar-wrap'>
      {/* TabBar Container */}
      <View className='custom-tabbar'>
        <View className='custom-tabbar-inner'>
          {TABS.map((tab, index) => {
            const isActive = selected === index
            const isAnimating = animatingIdx === index
            return (
              <View key={tab.key} style={{ display: 'contents' }}>
                {/* Insert floating center button before suggest tab */}
                {index === 2 && (
                  <View key='center-add' className='tabbar-center' onClick={handleAddClick}>
                    <View className='tabbar-center-btn'>
                      <View className='tabbar-center-btn-glow' />
                      <Text className='tabbar-center-icon'>＋</Text>
                    </View>
                  </View>
                )}
                <View
                  className={`tabbar-item ${isActive ? 'tabbar-item--active' : ''} ${isAnimating ? 'tabbar-item--animating' : ''}`}
                  onClick={() => handleTabClick(index)}
                >
                  <View className='tabbar-item-icon-wrap'>
                    <Image src={icons[isActive ? tab.selectedIcon : tab.icon]} className={`tabbar-item-icon ${isAnimating ? 'tabbar-item-icon--bounce' : ''}`} style={{width: '48rpx', height: '48rpx', marginBottom: '6rpx'}} />
                    {isActive && <View className='tabbar-item-indicator' />}
                  </View>
                  <Text className='tabbar-item-text'>{tab.text}</Text>
                </View>
              </View>
            )
          })}
        </View>
        {/* Safe area spacer */}
        <View className='tabbar-safe-area' />
      </View>
    </View>
  )
}

