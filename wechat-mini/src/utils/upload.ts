import Taro from '@tarojs/taro'
import { uploadFile } from './api'

/**
 * Shared photo capture + upload utility.
 * Prompts the user to take or choose a photo, then uploads it to the given endpoint.
 * Returns true if upload succeeded, false otherwise.
 */
export async function captureAndUpload(
  endpoint: string = '/items',
  options?: {
    loadingTitle?: string
    successMessage?: string
  }
): Promise<boolean> {
  const loadingTitle = options?.loadingTitle || '上传中...'
  const successMessage = options?.successMessage || '添加成功'

  try {
    const res = await Taro.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
    })

    if (res.tempFiles && res.tempFiles.length > 0) {
      const filePath = res.tempFiles[0].tempFilePath
      Taro.showLoading({ title: loadingTitle })

      try {
        await uploadFile(endpoint, filePath, 'image')
        Taro.hideLoading()
        Taro.showToast({ title: successMessage, icon: 'success' })
        return true
      } catch (uploadErr) {
        Taro.hideLoading()
        console.error('Upload error:', uploadErr)
        const msg = uploadErr instanceof Error ? uploadErr.message : '上传没成功'
        Taro.showToast({ title: msg, icon: 'none', duration: 3000 })
        return false
      }
    }
    return false
  } catch (err) {
    console.error('Choose media failed:', err)
    // Don't show error if user just cancelled
    return false
  }
}