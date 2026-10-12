import { View, Text, Image } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import { api, setAccessToken, resolveImageUrl, getBodyPhoto } from '../../utils/api'
import { UserProfile } from '../../types'
import EditProfileSheet from '../../components/EditProfileSheet'
import './index.scss'
import { icons } from '../../constants/icons'

interface FamilyMember {
  id: string
  display_name: string
  avatar_url?: string
  role: string
}

interface FamilyInfo {
  id: string
  name: string
  invite_code: string
  members: FamilyMember[]
}

export default function ProfilePage() {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [family, setFamily] = useState<FamilyInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [itemCount, setItemCount] = useState(0)
  const [outfitCount, setOutfitCount] = useState(0)
  const [hasBodyPhoto, setHasBodyPhoto] = useState(false)
  const [editVisible, setEditVisible] = useState(false)

  useDidShow(() => {
    loadProfile()
    loadBodyPhoto()
  })

  const loadProfile = async () => {
    setLoading(true)
    try {
      const [userRes, familyRes] = await Promise.allSettled([
        api.get<UserProfile>('/users/me'),
        api.get<FamilyInfo>('/families/me'),
      ])
      if (userRes.status === 'fulfilled') setUser(userRes.value)
      if (familyRes.status === 'fulfilled') setFamily(familyRes.value)
      // Load stats
      try { const items = await api.get<{total:number}>('/items', {page:'1',page_size:'1'}); setItemCount(items.total||0) } catch {}
      try { const outfits = await api.get<{items:any[]}>('/outfits', {page:'1',page_size:'1'}); setOutfitCount(outfits.items?.length||0) } catch {}
    } catch (err) {
      console.error('Failed to load profile:', err)
    } finally {
      setLoading(false)
    }
  }

  const loadBodyPhoto = async () => {
    try {
      const res = await getBodyPhoto()
      setHasBodyPhoto(!!res?.photo_url)
    } catch {
      setHasBodyPhoto(false)
    }
  }

  const handleLogout = () => {
    Taro.showModal({
      title: '确定要退出吗',
      content: '退出后需要重新登录',
      success: (res) => {
        if (res.confirm) {
          setAccessToken(null)
          Taro.redirectTo({ url: '/pages/login/index' })
        }
      }
    })
  }

  const QUICK_ICONS = [
    { icon: icons['bar-chart-3'], label: '统计', page: '/pages/analytics/index' },
    { icon: icons['settings'], label: '偏好', page: '/pages/preferences/index' },
    { icon: icons['calendar'], label: '日记', page: '/pages/history/index' },
    { icon: icons['bot'], label: 'AI对话', page: '/pages/chat/index' },
  ]

  const MENU_GROUPS = [
    [
      { icon: icons['user'], label: '个人档案', page: '/pages/profile-settings/index', desc: '基本信息、身材数据、风格偏好' },
    ],
    [
      { icon: icons['bar-chart-3'], label: '衣橱统计', page: '/pages/analytics/index', desc: '穿搭数据洞察' },
      { icon: icons['calendar'], label: '穿搭日记', page: '/pages/history/index', desc: '记录每日穿搭' },
      { icon: icons['bot'], label: 'AI 造型师', page: '/pages/chat/index', desc: '穿搭灵感对话' },
    ],
    [
      { icon: icons['users'], label: '穿搭社区', page: '/pages/community/index', desc: '社区穿搭互助' },
      { icon: icons['gem'], label: '会员中心', page: '/pages/membership/index', desc: '解锁更多 AI 功能' },
    ],
  ]

  const handleMenuTap = (page: string) => {
    if (page) {
      Taro.navigateTo({ url: page })
    } else {
      Taro.showToast({ title: '这个功能还在路上', icon: 'none' })
    }
  }

  return (
    <View className='profile-page'>
      {/* User Info Header */}
      <View className='profile-header'>
        <View className='profile-header-content'>
          {loading ? (
            <Text className='profile-loading-text'>加载中...</Text>
          ) : user ? (
            <>
              <View className='profile-user-tappable' onClick={() => setEditVisible(true)}>
                <View className='profile-avatar'>
                  {user.avatar_url ? (
                    <Image className='profile-avatar-img' src={resolveImageUrl(user.avatar_url) || user.avatar_url} />
                  ) : (
                    <View className='profile-avatar-placeholder'>
                      <Image src={icons['user']} className='profile-avatar-emoji' style={{width: '48rpx', height: '48rpx'}} />
                    </View>
                  )}
                </View>
                <View className='profile-name-row'>
                  <Text className='profile-name'>{user.display_name}</Text>
                  <Text className='profile-edit-pencil'>✏️</Text>
                </View>
              </View>
              <View className='profile-stats'>
                <View className='profile-stat'>
                  <Text className='profile-stat-num'>{itemCount}</Text>
                  <Text className='profile-stat-label'>衣物</Text>
                </View>
                <View className='profile-stat'>
                  <Text className='profile-stat-num'>{outfitCount}</Text>
                  <Text className='profile-stat-label'>搭配</Text>
                </View>
              </View>
            </>
          ) : (
            <Text className='profile-loading-text'>加载失败</Text>
          )}
        </View>
      </View>

      {/* Membership Banner */}
      <View className='membership-banner'>
        <View className='membership-banner-left'>
          <Image src={icons['gem']} className='membership-banner-diamond' style={{width: '48rpx', height: '48rpx'}} />
          <View className='membership-banner-info'>
            <Text className='membership-banner-title'>魔搭幻穿邀请您成为会员</Text>
            <Text className='membership-banner-sub'>更多会员权益等你开启</Text>
          </View>
        </View>
        <View className='membership-banner-btn' onClick={() => Taro.navigateTo({ url: '/pages/membership/index' })}>
          <Text className='membership-banner-btn-text'>了解会员</Text>
        </View>
      </View>

      {/* Quick Icon Row */}
      <View className='quick-icons'>
        {QUICK_ICONS.map((item, idx) => (
          <View
            key={idx}
            className='quick-icon-item'
            onClick={() => handleMenuTap(item.page)}
          >
            <Image src={item.icon} className='quick-icon-emoji' style={{width: '48rpx', height: '48rpx'}} />
            <Text className='quick-icon-label'>{item.label}</Text>
          </View>
        ))}
      </View>

      {/* Family Section */}
      {family && family.members.length > 0 && (
        <View className='family-section'>
          <View className='family-header'>
            <Text className='family-title'>{family.name || '我的家庭'}</Text>
            <Text className='family-count'>{family.members.length} 人</Text>
          </View>
          <View className='family-members'>
            {family.members.map((member) => (
              <View key={member.id} className='family-member'>
                <View className='family-avatar'>
                  <Text className='family-avatar-text'>{member.display_name[0]}</Text>
                </View>
                <Text className='family-name'>{member.display_name}</Text>
                <Text className='family-role'>{member.role === 'admin' ? '管理员' : '成员'}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Menu Groups */}
      {MENU_GROUPS.map((group, gIdx) => (
        <View key={gIdx} className='menu-group'>
          {group.map((item, idx) => (
            <View key={idx} onClick={() => handleMenuTap(item.page)}>
              <View className='menu-item'>
                <View className='menu-item-left'>
                  <Image src={item.icon} className='menu-item-icon' style={{width: '48rpx', height: '48rpx'}} />
                  <View className='menu-item-text-wrap'>
                    <Text className='menu-item-label'>{item.label}</Text>
                    {'desc' in item && <Text className='menu-item-desc'>{(item as any).desc}</Text>}
                  </View>
                </View>
                <Text className='menu-item-arrow'>›</Text>
              </View>
              {idx < group.length - 1 && <View className='menu-divider' />}
            </View>
          ))}
        </View>
      ))}

      {/* Logout */}
      <View className='logout-btn' onClick={handleLogout}>
        <Text className='logout-text'>退出登录</Text>
      </View>

      {/* Version */}
      <View className='version'>
        <Text className='version-text'>魔搭幻穿 v1.0.0</Text>
      </View>

      {/* Bottom padding for tabbar */}
      <View style={{ height: '260rpx' }} />

      {/* Edit profile sheet (avatar + nickname) */}
      {user && (
        <EditProfileSheet
          visible={editVisible}
          displayName={user.display_name}
          avatarUrl={user.avatar_url}
          onClose={() => setEditVisible(false)}
          onSaved={(data) =>
            setUser((prev) =>
              prev
                ? { ...prev, display_name: data.display_name, avatar_url: data.avatar_url || undefined }
                : prev
            )
          }
        />
      )}
    </View>
  )
}
