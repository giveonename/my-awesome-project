import { View, Text, Image, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useCallback, useEffect } from 'react'
import { uploadFile, resolveImageUrl, request } from '../../utils/api'
import './index.scss'
import { icons } from '../../constants/icons'

type ParseState = 'idle' | 'scanning' | 'result' | 'saving' | 'error' | 'success'

interface ParsedItem {
  name: string
  type: string
  primary_color?: string
  material?: string
  style?: string[]
  confidence?: number
  category?: string
  segmented_image_path?: string
  thumbnail_url?: string
}

interface ParseResult {
  items: ParsedItem[]
  count: number
  image_path?: string
}

export default function ParsePage() {
  const [activeTab, setActiveTab] = useState<'outfit' | 'flat'>('flat')
  const [autoMode, setAutoMode] = useState(false)

  // Read initial tab and auto-upload from URL params
  useEffect(() => {
    const pages = Taro.getCurrentPages()
    const currentPage = pages[pages.length - 1]
    if (currentPage) {
      const opts = (currentPage as any).options || {}
      if (opts.tab === 'outfit' || opts.tab === 'flat') {
        setActiveTab(opts.tab)
      }
      if (opts.auto === '1' && opts.img) {
        setAutoMode(true)
        const imgPath = decodeURIComponent(opts.img)
        setParseState('scanning')
        const sceneType = opts.tab === 'outfit' ? 'avatar' : 'commodity'
        ;(async () => {
          try {
            const uploadResult = await uploadFile<ParseResult>(
              '/items/parse',
              imgPath,
              'image',
              { scene_type: sceneType },
              300000
            )
            setResult({
              items: uploadResult.items || [],
              count: uploadResult.count || 0,
              image_path: uploadResult.image_path,
            })
            setImageUrl(imgPath)
            setParseState('result')
          } catch (err) {
            const msg = err instanceof Error ? err.message : '解析遇到了点状况'
            setErrorMsg(msg)
            setParseState('error')
          }
        })()
      }
    }
  }, [])

  const [parseState, setParseState] = useState<ParseState>('idle')
  const [imageUrl, setImageUrl] = useState('')
  const [result, setResult] = useState<ParseResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [loadingText, setLoadingText] = useState('')
  const [saveResult, setSaveResult] = useState<{ created: number; failed: number; errors?: string[] } | null>(null)

  // --- Multi-select state for garment cards ---
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())

  const toggleSelect = useCallback((idx: number) => {
    setSelectedIndices(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (!result?.items?.length) return
    setSelectedIndices(prev => {
      if (prev.size === result.items.length) return new Set()
      return new Set(result.items.map((_, i) => i))
    })
  }, [result])

  const selectedCount = selectedIndices.size

  // --- Upload handler: accepts a specific tab type ---
  const handleUploadWithType = useCallback(async (type: 'outfit' | 'flat') => {
    setActiveTab(type)
    try {
      const res = await Taro.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['camera', 'album'],
        sizeType: ['compressed'],
      })
      if (!res.tempFiles?.length) return

      const filePath = res.tempFiles[0].tempFilePath
      setImageUrl(filePath)
      setParseState('scanning')
      setErrorMsg('')
      setResult(null)
      setSelectedIndices(new Set())

      try {
        const sceneType = type === 'outfit' ? 'avatar' : 'commodity'
        const uploadResult = await uploadFile<ParseResult>(
          '/items/parse',
          filePath,
          'image',
          { scene_type: sceneType },
          300000
        )
        setResult({
          items: uploadResult.items || [],
          count: uploadResult.count || 0,
          image_path: uploadResult.image_path,
        })
        setParseState('result')
      } catch (err) {
        console.error('Parse failed:', err)
        const msg = err instanceof Error ? err.message : '解析遇到了点状况'
        setErrorMsg(msg)
        setParseState('error')
      }
    } catch (err) {
      console.log('User cancelled media selection')
    }
  }, [])

  // --- Camera-only handler ---
  const handleCamera = useCallback(async (type: 'outfit' | 'flat') => {
    setActiveTab(type)
    try {
      const res = await Taro.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['camera'],
        sizeType: ['compressed'],
      })
      if (!res.tempFiles?.length) return

      const filePath = res.tempFiles[0].tempFilePath
      setImageUrl(filePath)
      setParseState('scanning')
      setErrorMsg('')
      setResult(null)
      setSelectedIndices(new Set())

      try {
        const sceneType = type === 'outfit' ? 'avatar' : 'commodity'
        const uploadResult = await uploadFile<ParseResult>(
          '/items/parse',
          filePath,
          'image',
          { scene_type: sceneType },
          300000
        )
        setResult({
          items: uploadResult.items || [],
          count: uploadResult.count || 0,
          image_path: uploadResult.image_path,
        })
        setParseState('result')
      } catch (err) {
        console.error('Parse failed:', err)
        const msg = err instanceof Error ? err.message : '解析遇到了点状况'
        setErrorMsg(msg)
        setParseState('error')
      }
    } catch (err) {
      console.log('User cancelled camera')
    }
  }, [])

  // --- handleUpload: delegates to handleUploadWithType for autoMode retry ---
  const handleUpload = useCallback(async () => {
    await handleUploadWithType(activeTab)
  }, [activeTab, handleUploadWithType])

  const handleRetry = useCallback(() => {
    setParseState('idle')
    setImageUrl('')
    setResult(null)
    setErrorMsg('')
    setLoadingText('')
    setSelectedIndices(new Set())
  }, [])

  const handleSaveItems = useCallback(async () => {
    if (!result?.items?.length || selectedCount === 0) return

    setParseState('saving')
    setLoadingText(activeTab === 'outfit' ? '正在加入试衣间...' : '正在加入衣橱...')

    try {
      const sceneType = activeTab === 'outfit' ? 'avatar' : 'commodity'
      const selectedItems = result.items.filter((_, i) => selectedIndices.has(i))
      const saveRes = await request<{ created: number; failed: number }>(
        '/items/from-parse',
        {
          method: 'POST',
          data: {
            items: selectedItems,
            image_path: result.image_path || null,
            scene_type: sceneType,
          },
          timeout: 300000,
        }
      )

      setLoadingText('')

      setTimeout(() => {
        setParseState('success' as ParseState)
        setSaveResult(saveRes)
      }, 600)
    } catch (err) {
      setParseState('result')
      console.error('Save items failed:', err)
      Taro.showToast({ title: '保存没成功，再试一次？', icon: 'none' })
    }
  }, [result, activeTab, selectedIndices, selectedCount])

  const tabLabel = activeTab === 'outfit' ? '穿搭照' : '平铺图'

  // Ellipsis animation text
  const [dots, setDots] = useState('')
  useEffect(() => {
    if (parseState !== 'scanning') { setDots(''); return }
    const timer = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.')
    }, 500)
    return () => clearInterval(timer)
  }, [parseState])

  return (
    <View className='parse-page'>
      {/* ============ Frosted Glass Loading Overlay ============ */}
      {parseState === 'saving' && (
        <View className='parse-loading-overlay'>
          <View className='parse-loading-backdrop' />
          <View className='parse-loading-card'>
            <View className='parse-loading-ring'>
              <View className='parse-loading-ring-inner' />
            </View>
            <Text className='parse-loading-text'>
              {loadingText || 'AI 正在为你剥离衣物资产...'}
            </Text>
            <View className='parse-loading-steps'>
              <View className='parse-loading-step parse-loading-step--done'>
                <View className='parse-loading-step-dot' />
                <Text className='parse-loading-step-text'>AI 识别完成</Text>
              </View>
              <View className='parse-loading-step parse-loading-step--active'>
                <View className='parse-loading-step-dot' />
                <Text className='parse-loading-step-text'>剥离衣物背景...</Text>
              </View>
              <View className='parse-loading-step'>
                <View className='parse-loading-step-dot' />
                <Text className='parse-loading-step-text'>生成透明资产</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* ============ Header ============ */}
      <View className='parse-header'>
        {!autoMode && parseState === 'idle' && (
          <View className='parse-header-title'>
            <Text className='parse-header-title-text'>AI 批量解析</Text>
          </View>
        )}
        {autoMode && (
          <View className='parse-tabs'>
            <View className={`parse-tab ${activeTab === 'outfit' ? 'parse-tab--active' : ''}`}>
              <Text className='parse-tab-text'>解析穿搭照</Text>
            </View>
            <View className={`parse-tab ${activeTab === 'flat' ? 'parse-tab--active' : ''}`}>
              <Text className='parse-tab-text'>解析平铺图</Text>
            </View>
          </View>
        )}
      </View>

      {/* ============ Content ============ */}
      <View className='parse-content'>
        {/* ======== IDLE: Immersive Upload (non-autoMode) ======== */}
        {parseState === 'idle' && !autoMode && (
          <View className='parse-immersive animate-fade-in-up'>
            {/* Gradient hero area */}
            <View className='parse-hero'>
              <View className='parse-hero-ring' />
              <View className='parse-hero-inner'>
                <Image src={icons['sparkles']} className='parse-hero-icon' style={{ width: '80rpx', height: '80rpx' }} />
                <Text className='parse-hero-title'>AI 智能识别</Text>
                <Text className='parse-hero-desc'>拍一张照片，自动识别并入库</Text>
              </View>

              {/* AI badge - subtle */}
              <View className='parse-ai-pill'>
                <Image src={icons['bot']} className='parse-ai-pill-icon' style={{ width: '28rpx', height: '28rpx' }} />
                <Text className='parse-ai-pill-text'>AI 驱动</Text>
              </View>
            </View>

            {/* Dual action buttons */}
            <View className='parse-dual-actions'>
              <View className='parse-action-card' onClick={() => handleUploadWithType('flat')}>
                <View className='parse-action-icon-wrap'>
                  <Image src={icons['shirt']} className='parse-action-icon' style={{ width: '56rpx', height: '56rpx' }} />
                </View>
                <Text className='parse-action-title'>平铺图解析</Text>
                <Text className='parse-action-desc'>单件衣物平铺拍照</Text>
                <View className='parse-action-btn'>
                  <Image src={icons['camera']} className='parse-action-btn-icon' style={{ width: '32rpx', height: '32rpx' }} />
                  <Text className='parse-action-btn-text'>拍照 / 相册</Text>
                </View>
              </View>

              <View className='parse-action-card' onClick={() => handleUploadWithType('outfit')}>
                <View className='parse-action-icon-wrap parse-action-icon-wrap--accent'>
                  <Image src={icons['eye']} className='parse-action-icon' style={{ width: '56rpx', height: '56rpx' }} />
                </View>
                <Text className='parse-action-title'>穿搭照解析</Text>
                <Text className='parse-action-desc'>全身穿搭一键拆解</Text>
                <View className='parse-action-btn'>
                  <Image src={icons['camera']} className='parse-action-btn-icon' style={{ width: '32rpx', height: '32rpx' }} />
                  <Text className='parse-action-btn-text'>拍照 / 相册</Text>
                </View>
              </View>
            </View>

            {/* Feature pills */}
            <View className='parse-features'>
              <View className='parse-feature-pill'>
                <Image src={icons['scan']} className='parse-feature-icon' style={{ width: '28rpx', height: '28rpx' }} />
                <Text className='parse-feature-text'>自动识别</Text>
              </View>
              <View className='parse-feature-pill'>
                <Image src={icons['scissors']} className='parse-feature-icon' style={{ width: '28rpx', height: '28rpx' }} />
                <Text className='parse-feature-text'>智能抠图</Text>
              </View>
              <View className='parse-feature-pill'>
                <Image src={icons['zap']} className='parse-feature-icon' style={{ width: '28rpx', height: '28rpx' }} />
                <Text className='parse-feature-text'>批量入库</Text>
              </View>
            </View>
          </View>
        )}

        {/* ======== IDLE: AutoMode placeholder (from FAB) ======== */}
        {parseState === 'idle' && autoMode && (
          <View className='parse-upload-card animate-fade-in-up'>
            <View className='parse-upload-preview'>
              <View className='parse-upload-placeholder' onClick={() => handleUploadWithType(activeTab)}>
                <Image src={icons['camera']} className='parse-upload-emoji' style={{ width: '48rpx', height: '48rpx' }} />
                <Text className='parse-upload-hint'>点击上传{tabLabel}</Text>
              </View>
            </View>
          </View>
        )}

        {/* ======== Scanning ======== */}
        {parseState === 'scanning' && (
          <View className='parse-scan-card animate-fade-in-up'>
            <View className='parse-scan-preview'>
              <View className='parse-image-wrap'>
                <Image className='parse-image' src={imageUrl} mode='widthFix' />
                <View className='parse-scan-overlay'>
                  <View className='parse-scan-line'>
                    <View className='parse-scan-line-trail' />
                  </View>
                </View>
                <View className='parse-scan-pulse' />
              </View>
            </View>
            <View className='parse-scan-status'>
              <View className='parse-scan-ring-wrap'>
                <View className='parse-scan-ring' />
              </View>
              <Text className='parse-scan-text'>AI 正在识别{tabLabel}{dots}</Text>
            </View>
          </View>
        )}

        {/* ======== Result ======== */}
        {parseState === 'result' && result && (
          <View className='parse-result-card animate-fade-in-up'>
            <View className='parse-result-header'>
              <View className='parse-result-icon-wrap'>
                <Image src={icons['party-popper']} className='parse-result-icon' style={{ width: '48rpx', height: '48rpx' }} />
              </View>
              <View className='parse-result-header-text'>
                <Text className='parse-result-title'>识别到 {result.count} 件衣物</Text>
                <Text className='parse-result-subtitle'>选择需要保存的单品</Text>
              </View>
            </View>

            {/* Garment selection grid (scrollable, padded for sticky bar) */}
            <ScrollView className='parse-garment-scroll' scrollY enhanced showScrollbar={false}>
              {result.items.map((item, idx) => (
                <View
                  key={idx}
                  className={`parse-garment-card ${selectedIndices.has(idx) ? 'parse-garment-card--selected' : ''}`}
                  onClick={() => toggleSelect(idx)}
                >
                  <View className='parse-garment-img-wrap'>
                    {item.thumbnail_url ? (
                      <Image
                        className='parse-garment-img'
                        src={resolveImageUrl(item.thumbnail_url) || ''}
                        mode='aspectFit'
                      />
                    ) : (
                      <View className='parse-garment-img-placeholder'>
                        <Image src={icons['shirt']} className='parse-garment-img-emoji' style={{ width: '48rpx', height: '48rpx' }} />
                      </View>
                    )}
                  </View>
                  <View className='parse-garment-info'>
                    <Text className='parse-garment-name'>{item.name}</Text>
                    <View className='parse-garment-meta'>
                      <Text className='parse-garment-type'>{item.type}</Text>
                      {item.primary_color && (
                        <>
                          <Text className='parse-garment-dot'>·</Text>
                          <View className='parse-garment-color-dot' style={{ backgroundColor: item.primary_color }} />
                          <Text className='parse-garment-color'>{item.primary_color}</Text>
                        </>
                      )}
                    </View>
                    <View className='parse-garment-tags'>
                      {item.material && (
                        <Text className='parse-garment-tag'>{item.material}</Text>
                      )}
                      {item.style?.slice(0, 2).map((s, i) => (
                        <Text key={i} className='parse-garment-tag'>{s}</Text>
                      ))}
                      {item.confidence != null && item.confidence > 0 && (
                        <Text className='parse-garment-confidence'>{Math.round(item.confidence * 100)}%</Text>
                      )}
                    </View>
                  </View>
                  <View className='parse-garment-check'>
                    <View className={`parse-garment-checkbox ${selectedIndices.has(idx) ? 'parse-garment-checkbox--checked' : ''}`}>
                      {selectedIndices.has(idx) && (
                        <Image src={icons['check']} className='parse-garment-checkbox-icon' style={{ width: '28rpx', height: '28rpx' }} />
                      )}
                    </View>
                  </View>
                </View>
              ))}
            </ScrollView>

            {/* Retry link */}
            <View className='parse-retry-link' onClick={handleRetry}>
              <Text className='parse-retry-link-text'>重新上传</Text>
            </View>
          </View>
        )}

        {/* ======== Error ======== */}
        {parseState === 'error' && (
          <View className='parse-error-card animate-fade-in-up'>
            <View className='parse-error-icon-wrap'>
              <Image src={icons['smile']} className='parse-error-icon' style={{ width: '56rpx', height: '56rpx' }} />
            </View>
            <Text className='parse-error-title'>解析遇到了点状况</Text>
            <Text className='parse-error-desc'>
              {errorMsg || '可能是图片不太清晰，换一张试试？'}
            </Text>
            <View className='parse-error-actions'>
              <View className='parse-retry-btn press-scale' onClick={handleRetry}>
                <Text className='parse-retry-btn-text'>重新上传</Text>
              </View>
              {autoMode && (
                <View className='parse-retry-btn parse-retry-btn--secondary press-scale' onClick={() => { setAutoMode(false); setParseState('idle') }}>
                  <Text className='parse-retry-btn-text parse-retry-btn-text--secondary'>手动选择</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* ======== Success ======== */}
        {parseState === 'success' && (
          <View className='parse-success-card animate-fade-in-up'>
            <View className='parse-success-icon-wrap'>
              <Image src={icons['check-circle']} className='parse-success-icon' style={{ width: '64rpx', height: '64rpx' }} />
            </View>
            <Text className='parse-success-title'>保存成功</Text>
            <Text className='parse-success-count'>
              {saveResult?.created ?? result?.items.length ?? 0} 件衣物已入库
            </Text>
            {saveResult && saveResult.failed > 0 && (
              <Text className='parse-success-failed'>
                {saveResult.failed} 件保存失败{saveResult.errors?.length ? `：${saveResult.errors[0]}` : ''}
              </Text>
            )}
            <View className='parse-success-actions'>
              <View className='parse-success-btn press-scale' onClick={() => Taro.navigateBack()}>
                <Text className='parse-success-btn-text'>返回衣橱</Text>
              </View>
              <View className='parse-success-btn parse-success-btn--secondary press-scale' onClick={handleRetry}>
                <Text className='parse-success-btn-text parse-success-btn-text--secondary'>继续扫描</Text>
              </View>
            </View>
          </View>
        )}
      </View>

      {/* ============ Sticky Bottom Action Bar (result state) ============ */}
      {parseState === 'result' && result && (
        <View className='parse-sticky-bar'>
          <View className='parse-sticky-left' onClick={toggleSelectAll}>
            <Text className='parse-sticky-select-text'>
              {selectedCount === result.items.length ? '取消全选' : '全选'}
            </Text>
          </View>
          <View
            className={`parse-sticky-save ${selectedCount > 0 ? 'parse-sticky-save--active' : ''}`}
            onClick={selectedCount > 0 ? handleSaveItems : undefined}
          >
            <Text className='parse-sticky-save-text'>
              {activeTab === 'outfit' ? '加入试衣间' : '加入衣橱'}
              {selectedCount > 0 ? `（${selectedCount}）` : ''}
            </Text>
          </View>
        </View>
      )}
    </View>
  )
}
