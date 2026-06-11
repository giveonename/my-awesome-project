import { icons } from '../../constants/icons'
import { View, Text, Image, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useCallback, useEffect, useRef } from 'react'
import { submitTryOn, getTryOnStatus, resolveImageUrl, TryOnStatusResponse, uploadBodyPhoto, getBodyPhoto, getBackgrounds, swapBackground, BackgroundItem } from '../../utils/api'
import { API_BASE } from '../../utils/api'
import './index.scss'

type ModalState = 'checking' | 'loading' | 'result' | 'error'

interface VirtualTryOnModalProps {
  visible: boolean
  garmentItemIds: string[]
  garmentNames?: string[]
  onClose: () => void
  onSave?: (imageUrl: string) => void
  onShare?: (imageUrl: string) => void
}

const POLL_INTERVAL = 3000 // 3 seconds
const MAX_POLLS = 60 // 3 minutes max (aitryon-plus ~45s)

export default function VirtualTryOnModal({
  visible,
  garmentItemIds,
  garmentNames = [],
  onClose,
  onSave,
  onShare,
}: VirtualTryOnModalProps) {
  const [state, setState] = useState<ModalState>('checking')
  const [resultImageUrl, setResultImageUrl] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [elapsedTime, setElapsedTime] = useState(0)
  const [modelName, setModelName] = useState('')
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hasStartedRef = useRef(false)
  const [hasBodyPhoto, setHasBodyPhoto] = useState<boolean | null>(null)
  const [bodyPhotoChecked, setBodyPhotoChecked] = useState(false)
  const [showPhotoPrompt, setShowPhotoPrompt] = useState(false)
  const [photoStep, setPhotoStep] = useState<'intro' | 'capture' | 'confirm'>('intro')
  const [uploadedPhotoUrl, setUploadedPhotoUrl] = useState('')
  const [backgrounds, setBackgrounds] = useState<BackgroundItem[]>([])
  const [activeBg, setActiveBg] = useState<string>('original')
  const [bgLoading, setBgLoading] = useState(false)
  const [originalImageUrl, setOriginalImageUrl] = useState('')

  // Cleanup timers
  const cleanup = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
  }, [])

  // Start the try-on process
  const startTryOn = useCallback(async () => {
    if (!garmentItemIds.length) return

    setState('loading')
    setErrorMsg('')
    setElapsedTime(0)
    hasStartedRef.current = true

    // Start elapsed time counter
    elapsedTimerRef.current = setInterval(() => {
      setElapsedTime(prev => prev + 1)
    }, 1000)

    try {
      // Submit async task
      const submitResult = await submitTryOn({
        garment_item_ids: garmentItemIds,
        use_plus: true,
      })

      setModelName(submitResult.model_used)

      // Start polling
      let pollCount = 0
      pollTimerRef.current = setInterval(async () => {
        pollCount++
        if (pollCount > MAX_POLLS) {
          cleanup()
          setErrorMsg('生成时间有点长，稍后再试试吧')
          setState('error')
          return
        }

        try {
          const status: TryOnStatusResponse = await getTryOnStatus(submitResult.task_id)

          if (status.status === 'SUCCEEDED' && status.image_url) {
            cleanup()
            console.log('[TryOn] Result URL:', status.image_url)
            console.log('[TryOn] Elapsed:', elapsedTime, 's')
            setOriginalImageUrl(status.image_url!)
            setResultImageUrl(status.image_url)
            setState('result')
          } else if (status.status === 'FAILED') {
            cleanup()
            setErrorMsg(status.error || '生成遇到了点状况')
            setState('error')
          }
          // Otherwise keep polling
        } catch (err) {
          // Polling error, continue trying
          console.warn('Poll error:', err)
        }
      }, POLL_INTERVAL)
    } catch (err: unknown) {
      cleanup()
      const message = err instanceof Error ? err.message : '提交失败，稍后再试试'
      setErrorMsg(message)
      setState('error')
    }
  }, [garmentItemIds, cleanup])

  // Check if user has body photo
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setBodyPhotoChecked(false)
    setState('checking')

    getBodyPhoto()
      .then(res => {
        if (cancelled) return
        setHasBodyPhoto(!!res?.photo_url)
      })
      .catch(() => {
        if (cancelled) return
        setHasBodyPhoto(false)
      })
      .finally(() => {
        if (cancelled) return
        setBodyPhotoChecked(true)
      })

    return () => {
      cancelled = true
    }
  }, [visible])

  // Handle body photo upload
  const handleUploadBodyPhoto = useCallback(async () => {
    try {
      const res = await Taro.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['camera', 'album'],
        sizeType: ['compressed'],
      })
      if (!res.tempFiles?.length) return

      Taro.showLoading({ title: '上传中...' })
      const filePath = res.tempFiles[0].tempFilePath
      const uploadRes = await uploadBodyPhoto(filePath)
      setHasBodyPhoto(true)
      setUploadedPhotoUrl(uploadRes?.photo_url || filePath)
      Taro.hideLoading()
      Taro.showToast({ title: '全身照上传成功', icon: 'success' })
    } catch (err) {
      Taro.hideLoading()
      const msg = err instanceof Error ? err.message : '上传失败'
      Taro.showToast({ title: msg, icon: 'none' })
    }
  }, [])

  // Skip photo prompt and use default model
  const handleSkipPhoto = useCallback(() => {
    setShowPhotoPrompt(false)
    setPhotoStep('intro')
    setHasBodyPhoto(false)
    hasStartedRef.current = false
    startTryOn()
  }, [startTryOn])

  // Photo upload success -> show confirm step
  const handleUploadBodyPhotoAndStart = useCallback(async () => {
    await handleUploadBodyPhoto()
    setPhotoStep('confirm')
  }, [handleUploadBodyPhoto])

  // Confirm photo -> start try-on
  const handleConfirmAndStart = useCallback(() => {
    setShowPhotoPrompt(false)
    hasStartedRef.current = false
    startTryOn()
  }, [startTryOn])

  // Auto-start when visible
  useEffect(() => {
    if (visible && garmentItemIds.length > 0 && !hasStartedRef.current) {
      if (!bodyPhotoChecked) {
        return
      }

      if (hasBodyPhoto === false && !showPhotoPrompt) {
        setPhotoStep('intro')
        setShowPhotoPrompt(true)
        return
      }

      if (showPhotoPrompt) {
        return
      }

      startTryOn()
    }

    if (!visible) {
      cleanup()
      hasStartedRef.current = false
      setBodyPhotoChecked(false)
      setShowPhotoPrompt(false)
      setPhotoStep('intro')
      setUploadedPhotoUrl('')
      setState('checking')
      setModelName('')
      setResultImageUrl('')
      setErrorMsg('')
      setElapsedTime(0)
    }
    return cleanup
  }, [visible, garmentItemIds, startTryOn, cleanup, bodyPhotoChecked, hasBodyPhoto, showPhotoPrompt])

  const handleSaveToAlbum = useCallback(async () => {
    if (!resultImageUrl) return
    try {
      // Local file paths (wxfile:// or USER_DATA_PATH) can be saved directly
      const isLocal = resultImageUrl.startsWith('wxfile://') || resultImageUrl.startsWith(Taro.env.USER_DATA_PATH)
      if (isLocal) {
        await Taro.saveImageToPhotosAlbum({ filePath: resultImageUrl })
      } else {
        const resolvedUrl = resolveImageUrl(resultImageUrl) || resultImageUrl
        const dlRes = await Taro.downloadFile({ url: resolvedUrl })
        await Taro.saveImageToPhotosAlbum({ filePath: dlRes.tempFilePath })
      }
      Taro.showToast({ title: '已保存到相册', icon: 'success' })
      onSave?.(resultImageUrl)
    } catch {
      Taro.showToast({ title: '保存失败', icon: 'none' })
    }
  }, [resultImageUrl, onSave])

  const handleShare = useCallback(() => {
    if (resultImageUrl) {
      onShare?.(resultImageUrl)
    }
  }, [resultImageUrl, onShare])

  const handleRetry = useCallback(() => {
    hasStartedRef.current = false
    startTryOn()
  }, [startTryOn])

  // Load available backgrounds
  useEffect(() => {
    if (state !== 'result') return
    getBackgrounds().then(setBackgrounds).catch(() => {})
  }, [state])

  // Handle background swap
  const handleBgSwap = useCallback(async (bgId: string) => {
    if (bgLoading) return
    if (bgId === 'original') {
      setActiveBg('original')
      setResultImageUrl(originalImageUrl)
      return
    }
    setBgLoading(true)
    setActiveBg(bgId)
    try {
      const localPath = await swapBackground(originalImageUrl, bgId)
      setResultImageUrl(localPath)
    } catch (err) {
      console.error('Background swap failed:', err)
      Taro.showToast({ title: '背景替换失败', icon: 'none' })
      setActiveBg('original')
      setResultImageUrl(originalImageUrl)
    } finally {
      setBgLoading(false)
    }
  }, [originalImageUrl, bgLoading])

  if (!visible) return null

  const garmentLabel = garmentNames.length > 0 ? garmentNames.join(' + ') : '选中的衣物'

  return (
    <View className='vtm-overlay' onClick={onClose}>
      <View className='vtm-modal' onClick={e => e.stopPropagation()}>
        {/* Close button */}
        <View className='vtm-close' onClick={onClose}>
          <Text className='vtm-close-icon'>✕</Text>
        </View>


        {/* ===== Body Photo Prompt ===== */}
        {showPhotoPrompt && photoStep === 'intro' && (
          <View className='vtm-photo-prompt'>
            <View className='vtm-photo-prompt-icon-wrap'>
              <Image src={icons['camera']} className='vtm-photo-prompt-icon' style={{width: '64rpx', height: '64rpx'}} />
            </View>
            <Text className='vtm-photo-prompt-title'>上传全身照，效果更真实</Text>
            <Text className='vtm-photo-prompt-desc'>拍一张正面全身照，AI 会用您的真实身形生成试穿效果</Text>

            <View className='vtm-photo-guide'>
              <View className='vtm-photo-guide-card'>
                <Text className='vtm-photo-guide-card-title'>推荐</Text>
                <Text className='vtm-photo-guide-card-text'>光线明亮、正面站立、穿着修身服装、完整露出头脚</Text>
              </View>
              <View className='vtm-photo-guide-card vtm-photo-guide-card--warn'>
                <Text className='vtm-photo-guide-card-title'>避免</Text>
                <Text className='vtm-photo-guide-card-text'>宽松外套遮挡、对镜自拍、光线昏暗、背景过于杂乱</Text>
              </View>
            </View>

            <View className='vtm-photo-prompt-actions'>
              <View className='vtm-photo-prompt-btn vtm-photo-prompt-btn--primary press-scale' onClick={() => setPhotoStep('capture')}>
                <Text className='vtm-photo-prompt-btn-text'>我准备好了，开始拍照</Text>
              </View>
              <View className='vtm-photo-prompt-btn press-scale' onClick={handleSkipPhoto}>
                <Text className='vtm-photo-prompt-btn-text vtm-photo-prompt-btn-text--skip'>先用默认模特试试</Text>
              </View>
            </View>
          </View>
        )}

        {showPhotoPrompt && photoStep === 'capture' && (
          <View className='vtm-photo-prompt'>
            <View className='vtm-photo-prompt-icon-wrap'>
              <Image src={icons['scan']} className='vtm-photo-prompt-icon' style={{width: '64rpx', height: '64rpx'}} />
            </View>
            <Text className='vtm-photo-prompt-title'>拍一张清晰的全身照</Text>
            <Text className='vtm-photo-prompt-desc'>尽量让身体居中，背景简洁，避免逆光和大面积遮挡</Text>
            <View className='vtm-photo-prompt-actions'>
              <View className='vtm-photo-prompt-btn vtm-photo-prompt-btn--primary press-scale' onClick={handleUploadBodyPhotoAndStart}>
                <Text className='vtm-photo-prompt-btn-text'>拍照或从相册选择</Text>
              </View>
              <View className='vtm-photo-prompt-btn press-scale' onClick={handleSkipPhoto}>
                <Text className='vtm-photo-prompt-btn-text vtm-photo-prompt-btn-text--skip'>暂时跳过</Text>
              </View>
            </View>
          </View>
        )}

        {showPhotoPrompt && photoStep === 'confirm' && (
          <View className='vtm-confirm'>
            <View className='vtm-confirm-glow' />
            <View className='vtm-confirm-badge'>
              <Text className='vtm-confirm-badge-text'>✅ 全身照就绪</Text>
            </View>
            <View className='vtm-confirm-preview'>
              {uploadedPhotoUrl ? (
                <Image
                  className='vtm-confirm-img'
                  src={resolveImageUrl(uploadedPhotoUrl) || uploadedPhotoUrl}
                  mode='aspectFill'
                />
              ) : (
                <View className='vtm-confirm-placeholder'>
                  <Text className='vtm-confirm-placeholder-icon'>📸</Text>
                </View>
              )}
            </View>
            <Text className='vtm-confirm-title'>你的数字分身已就绪</Text>
            <Text className='vtm-confirm-desc'>AI 将基于你的身形生成 1:1 试穿效果</Text>
            <View className='vtm-confirm-actions'>
              <View className='vtm-photo-prompt-btn vtm-photo-prompt-btn--primary press-scale' onClick={handleConfirmAndStart}>
                <Text className='vtm-photo-prompt-btn-text'>✨ 开始魔法试衣</Text>
              </View>
              <View className='vtm-photo-prompt-btn press-scale' onClick={() => setPhotoStep('capture')}>
                <Text className='vtm-photo-prompt-btn-text vtm-photo-prompt-btn-text--skip'>重新拍照</Text>
              </View>
            </View>
          </View>
        )}


        {/* ===== Checking State ===== */}
        {state === 'checking' && (
          <View className='vtm-loading'>
            <View className='vtm-loading-glow' />
            <View className='vtm-loading-ring'>
              <View className='vtm-loading-ring-inner' />
            </View>
            <Text className='vtm-loading-title'>✨ 准备为你试衣</Text>
            <Text className='vtm-loading-desc'>正在确认试衣资料...</Text>
            <Text className='vtm-loading-time' />
            <Text className='vtm-loading-hint'>
              {bodyPhotoChecked ? '已确认资料状态' : '正在检查是否需要全身照...'}
            </Text>
            <View className='vtm-loading-dots'>
              <View className='vtm-loading-dot' />
              <View className='vtm-loading-dot' />
              <View className='vtm-loading-dot' />
            </View>
          </View>
        )}

        {/* ===== Loading State ===== */}
        {state === 'loading' && (
          <View className='vtm-loading'>
            <View className='vtm-loading-glow' />
            <View className='vtm-loading-ring'>
              <View className='vtm-loading-ring-inner' />
            </View>
            <Text className='vtm-loading-title'>✨ AI 正在为你试衣</Text>
            <Text className='vtm-loading-desc'>{garmentLabel}</Text>
            <Text className='vtm-loading-time'>已等待 {elapsedTime} 秒</Text>
            <Text className='vtm-loading-hint'>
              {elapsedTime < 15
                ? '正在分析衣物特征...'
                : elapsedTime < 30
                  ? '正在匹配模特身形...'
                  : elapsedTime < 50
                    ? '正在渲染试衣效果...'
                    : '快好了，再等一小会儿...'}
            </Text>
            <View className='vtm-loading-dots'>
              <View className='vtm-loading-dot' />
              <View className='vtm-loading-dot' />
              <View className='vtm-loading-dot' />
            </View>
          </View>
        )}

        {/* ===== Result State ===== */}
        {state === 'result' && (
          <View className='vtm-result'>
            <View className='vtm-result-header'>
              <Text className='vtm-result-title'>🎉 试衣效果出炉</Text>
              {modelName && (
                <View className='vtm-result-badge'>
                  <Text className='vtm-result-badge-text'>{modelName}</Text>
                </View>
              )}
            </View>

            <View className='vtm-result-image-wrap'>
              <Image
                className='vtm-result-image'
                src={resolveImageUrl(resultImageUrl) || resultImageUrl}
                mode='widthFix'
                showMenuByLongpress
              />
            </View>

            <Text className='vtm-result-time'>耗时 {elapsedTime} 秒</Text>

            {/* Background Selector */}
            {backgrounds.length > 0 && (
              <View className="vtm-bg-selector">
                <Text className="vtm-bg-selector-title">✨ 换个背景</Text>
                <ScrollView scrollX className="vtm-bg-scroll">
                  <View className="vtm-bg-list">
                    <View
                      className={`vtm-bg-item ${activeBg === "original" ? "vtm-bg-item--active" : ""}`}
                      onClick={() => handleBgSwap("original")}
                    >
                      <Image
                        className="vtm-bg-preview-img"
                        src={resolveImageUrl(originalImageUrl) || resolveImageUrl(resultImageUrl) || ''}
                        mode="aspectFill"
                      />
                      <Text className="vtm-bg-name">原始</Text>
                    </View>
                    {backgrounds.filter(b => b.available).map(bg => (
                      <View
                        key={bg.id}
                        className={`vtm-bg-item ${activeBg === bg.id ? "vtm-bg-item--active" : ""} ${bgLoading && activeBg === bg.id ? "vtm-bg-item--loading" : ""}`}
                        onClick={() => handleBgSwap(bg.id)}
                      >
                        <Image
                          className="vtm-bg-preview-img"
                          src={`${API_BASE.replace('/api/v1', '')}/api/v1/virtual-tryon/backgrounds/${bg.id}/preview`}
                          mode="aspectFill"
                        />
                        <Text className="vtm-bg-name">{bg.name}</Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}


            <View className='vtm-result-actions'>
              <View className='vtm-result-btn vtm-result-btn--ghost' onClick={handleSaveToAlbum}>
                <Text className='vtm-result-btn-text'>💾 保存到相册</Text>
              </View>
              <View className='vtm-result-btn vtm-result-btn--primary' onClick={handleShare}>
                <Text className='vtm-result-btn-text'>📤 分享到发现</Text>
              </View>
            </View>

            <View className='vtm-result-retry' onClick={handleRetry}>
              <Text className='vtm-result-retry-text'>🔄 再来一张</Text>
            </View>
          </View>
        )}

        {/* ===== Error State ===== */}
        {state === 'error' && (
          <View className='vtm-error'>
            <Text className='vtm-error-icon'>😅</Text>
            <Text className='vtm-error-title'>试衣遇到了点状况</Text>
            <Text className='vtm-error-desc'>{errorMsg || '可能是图片不太合适，换一件试试？'}</Text>
            <View className='vtm-error-actions'>
              <View className='vtm-result-btn vtm-result-btn--ghost' onClick={onClose}>
                <Text className='vtm-result-btn-text'>关闭</Text>
              </View>
              <View className='vtm-result-btn vtm-result-btn--primary' onClick={handleRetry}>
                <Text className='vtm-result-btn-text'>重新生成</Text>
              </View>
            </View>
          </View>
        )}
      </View>
    </View>
  )
}


