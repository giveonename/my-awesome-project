import { View, Text, Image, Input, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useEffect } from 'react'
import { api, uploadFile, resolveImageUrl } from '../../utils/api'
import { icons } from '../../constants/icons'
import './index.scss'

interface EditProfileSheetProps {
  visible: boolean
  displayName: string
  avatarUrl?: string | null
  onClose: () => void
  onSaved: (data: { display_name: string; avatar_url: string | null }) => void
}

const MAX_NAME_LEN = 20

export default function EditProfileSheet({
  visible,
  displayName,
  avatarUrl,
  onClose,
  onSaved,
}: EditProfileSheetProps) {
  const [nickname, setNickname] = useState(displayName || '')
  // 微信头像选择返回本地临时文件；这里同时承载"远程头像 URL"两种形态
  const [avatarPreview, setAvatarPreview] = useState<string>(avatarUrl || '')
  const [avatarChanged, setAvatarChanged] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (visible) {
      setNickname(displayName || '')
      setAvatarPreview(avatarUrl || '')
      setAvatarChanged(false)
      setSaving(false)
    }
  }, [visible, displayName, avatarUrl])

  const handleChooseAvatar = (e: any) => {
    const url = e?.detail?.avatarUrl
    if (url) {
      setAvatarPreview(url)
      setAvatarChanged(true)
    }
  }

  const handleSave = async () => {
    if (saving) return
    const name = nickname.trim()
    if (!name) {
      Taro.showToast({ title: '昵称不能为空', icon: 'none' })
      return
    }
    if (name.length > MAX_NAME_LEN) {
      Taro.showToast({ title: `昵称最多 ${MAX_NAME_LEN} 个字`, icon: 'none' })
      return
    }

    setSaving(true)
    try {
      let savedAvatar: string | null = avatarUrl || null
      if (avatarChanged && avatarPreview) {
        const res = await uploadFile<{ avatar_url: string | null }>(
          '/users/me/avatar',
          avatarPreview,
          'image',
          {},
          60000
        )
        savedAvatar = res?.avatar_url ?? null
      }

      let savedName = displayName
      if (name !== displayName) {
        const res = await api.patch<{ display_name: string }>('/users/me', {
          display_name: name,
        })
        savedName = res?.display_name || name
      }

      Taro.showToast({ title: '已保存', icon: 'success' })
      onSaved({ display_name: savedName, avatar_url: savedAvatar })
      onClose()
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '保存失败，再试试', icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  if (!visible) return null

  return (
    <View className='eps-mask' onClick={onClose}>
      <View className='eps-sheet' onClick={(e) => e.stopPropagation()}>
        <View className='eps-header'>
          <Text className='eps-title'>编辑资料</Text>
          <Text className='eps-close' onClick={onClose}>
            ✕
          </Text>
        </View>

        <Button
          className='eps-avatar-btn'
          openType='chooseAvatar'
          onChooseAvatar={handleChooseAvatar}
        >
          {avatarPreview ? (
            <Image
              className='eps-avatar-img'
              src={resolveImageUrl(avatarPreview) || avatarPreview}
            />
          ) : (
            <View className='eps-avatar-placeholder'>
              <Image
                src={icons['user']}
                style={{ width: '56rpx', height: '56rpx' }}
              />
            </View>
          )}
          <View className='eps-avatar-badge'>
            <Text className='eps-avatar-badge-text'>✏️</Text>
          </View>
        </Button>
        <Text className='eps-avatar-hint'>点击头像，可直接使用微信头像</Text>

        <View className='eps-field'>
          <Text className='eps-field-label'>昵称</Text>
          <Input
            className='eps-input'
            type={'nickname' as any}
            value={nickname}
            maxlength={MAX_NAME_LEN}
            placeholder='点击输入昵称'
            onInput={(e) => setNickname(e.detail.value)}
          />
        </View>

        <View
          className={`eps-save ${saving ? 'eps-save--disabled' : ''}`}
          onClick={handleSave}
        >
          <Text className='eps-save-text'>{saving ? '保存中...' : '保存'}</Text>
        </View>
      </View>
    </View>
  )
}
