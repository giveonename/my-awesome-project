import { View, Text, ScrollView, Image} from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useEffect, useRef, useCallback } from 'react'
import './index.scss'
import { icons } from '../../constants/icons'

// ===== Types =====

type EvalState = 'idle' | 'questioning' | 'analyzing' | 'result'

interface QuizQuestion {
  id: string
  question: string
  options: { key: string; label: string; icon: string }[]
}

interface StyleReport {
  styleName: string
  styleTag: string
  colors: { name: string; hex: string }[]
  feedback: string
  strengths: string[]
  suggestions: string[]
}

// ===== Mock Quiz =====

const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: 'scene',
    question: '你的日常穿搭场景多为？',
    options: [
      { key: 'office', label: '职场通勤', icon: icons['briefcase'] },
      { key: 'casual', label: '休闲街头', icon: icons['shirt'] },
      { key: 'date', label: '精致约会', icon: icons['flower-2'] },
      { key: 'mixed', label: '各种都有', icon: icons['target'] },
    ],
  },
  {
    id: 'preference',
    question: '选衣服时你更看重什么？',
    options: [
      { key: 'comfort', label: '舒适度优先', icon: icons['cloud'] },
      { key: 'style', label: '颜值即正义', icon: icons['sparkles'] },
      { key: 'quality', label: '质感面料', icon: icons['shirt'] },
      { key: 'trend', label: '紧跟潮流', icon: icons['flame'] },
    ],
  },
  {
    id: 'color',
    question: '你的衣橱里最多的颜色是？',
    options: [
      { key: 'neutral', label: '黑白灰驼', icon: icons['heart'] },
      { key: 'pastel', label: '温柔浅色', icon: icons['flower-2'] },
      { key: 'bold', label: '亮眼撞色', icon: icons['palette'] },
      { key: 'earth', label: '大地色系', icon: icons['leaf'] },
    ],
  },
]

const ANALYZING_STEPS = [
  '正在解析你的风格偏好...',
  '正在匹配最佳色彩方案...',
  '正在生成专属风格报告...',
]

// ===== Mock Results =====

function generateReport(answers: Record<string, string>): StyleReport {
  const scene = answers.scene || 'mixed'
  const pref = answers.preference || 'style'
  const color = answers.color || 'neutral'

  const styleMap: Record<string, { name: string; tag: string }> = {
    'office-comfort-neutral': { name: 'Smart Casual 轻商务', tag: '简约利落' },
    'office-style-neutral': { name: 'Clean Fit 极简风', tag: '高级质感' },
    'casual-comfort-pastel': { name: 'Soft Casual 温柔休闲', tag: '舒适自然' },
    'casual-style-bold': { name: 'Street Style 街头风', tag: '个性张扬' },
    'date-style-pastel': { name: 'Romantic 浪漫风', tag: '优雅精致' },
    'date-quality-neutral': { name: 'Old Money 老钱风', tag: '低调奢华' },
  }

  const key = `${scene}-${pref}-${color}`
  const matched = styleMap[key] || { name: 'Eclectic Mix 混搭风', tag: '自由随性' }

  const colorSets: Record<string, { name: string; hex: string }[]> = {
    neutral: [
      { name: '经典黑', hex: '#1A1A1A' },
      { name: '纯净白', hex: '#F5F5F5' },
      { name: '高级灰', hex: '#9E9E9E' },
      { name: '驼色', hex: '#C4A882' },
    ],
    pastel: [
      { name: '樱花粉', hex: '#FFB7C5' },
      { name: '薄荷绿', hex: '#98D8C8' },
      { name: '雾霾蓝', hex: '#A8C0D0' },
      { name: '奶油黄', hex: '#F5E6CA' },
    ],
    bold: [
      { name: '电光蓝', hex: '#0066FF' },
      { name: '活力橙', hex: '#FF6B35' },
      { name: '薄荷绿', hex: '#00D4AA' },
      { name: '亮紫', hex: '#9B59B6' },
    ],
    earth: [
      { name: '焦糖棕', hex: '#8B5E3C' },
      { name: '橄榄绿', hex: '#6B7B3A' },
      { name: '沙色', hex: '#D4B896' },
      { name: '酒红', hex: '#722F37' },
    ],
  }

  return {
    styleName: matched.name,
    styleTag: matched.tag,
    colors: colorSets[color] || colorSets.neutral,
    feedback: `从你的选择来看，你是一个${matched.tag}的人。穿搭不仅是外在表达，更是内在态度的延伸。你对${pref === 'comfort' ? '舒适度' : pref === 'quality' ? '质感' : '美感'}的追求，让你在人群中自带一种从容的气质。`,
    strengths: [
      `${scene === 'office' ? '职场穿搭得体大方' : scene === 'date' ? '约会造型精致用心' : '日常搭配舒适自然'}，给人很好的第一印象`,
      `对${color === 'neutral' ? '基础色' : color === 'pastel' ? '柔和色系' : '色彩'}的运用有自己的理解`,
    ],
    suggestions: [
      `可以尝试加入一件${color === 'neutral' ? '低饱和度的彩色单品' : '经典中性色单品'}作为点缀`,
      `配饰是提升整体质感的关键，一条好的腰带或手表能画龙点睛`,
    ],
  }
}

// ===== Hooks =====

function useTypingEffect(messages: string[], interval: number = 1200): string {
  const [display, setDisplay] = useState('')
  const idxRef = useRef(0)

  useEffect(() => {
    idxRef.current = 0
    setDisplay(messages[0] || '')
    const timer = setInterval(() => {
      idxRef.current = (idxRef.current + 1) % messages.length
      setDisplay(messages[idxRef.current])
    }, interval)
    return () => clearInterval(timer)
  }, [messages, interval])

  return display
}

// ===== Component =====

export default function EvaluationPage() {
  const [state, setState] = useState<EvalState>('idle')
  const [currentQ, setCurrentQ] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [report, setReport] = useState<StyleReport | null>(null)

  const analyzingText = useTypingEffect(ANALYZING_STEPS, 1500)

  const handleStart = useCallback(() => {
    setCurrentQ(0)
    setAnswers({})
    setState('questioning')
  }, [])

  const handleAnswer = useCallback((questionId: string, answerKey: string) => {
    const newAnswers = { ...answers, [questionId]: answerKey }
    setAnswers(newAnswers)

    if (currentQ < QUIZ_QUESTIONS.length - 1) {
      setCurrentQ(currentQ + 1)
    } else {
      // Quiz complete → analyzing
      setState('analyzing')
      const minDelay = new Promise(resolve => setTimeout(resolve, 2500))
      const result = generateReport(newAnswers)

      minDelay.then(() => {
        setReport(result)
        setState('result')
      })
    }
  }, [answers, currentQ])

  const handleRetake = useCallback(() => {
    setState('idle')
    setReport(null)
    setAnswers({})
    setCurrentQ(0)
  }, [])

  return (
    <View className='ev-page'>
      {/* ===== IDLE: 风格诊断入口 ===== */}
      {state === 'idle' && (
        <ScrollView scrollY className='ev-landing'>
          {/* Hero */}
          <View className='ev-hero'>
            <View className='ev-hero-bg' />
            <View className='ev-hero-content'>
              <Text className='ev-hero-label'>WARDROWBE AI</Text>
              <Text className='ev-hero-title'>风格诊断</Text>
              <Text className='ev-hero-subtitle'>3 道题，找到最适合你的穿搭风格</Text>
            </View>
          </View>

          {/* 三个测评入口卡片 */}
          <View className='ev-features'>
            <View className='ev-feature-card animate-fade-in-up' style={{ animationDelay: '0ms' }}>
              <View className='ev-feature-icon-wrap' style={{ background: 'linear-gradient(135deg, #E8E4FD, #D4CCFA)' }}>
                <Image src={icons['palette']} className='ev-feature-icon' style={{width: '48rpx', height: '48rpx'}} />
              </View>
              <Text className='ev-feature-title'>适合色彩</Text>
              <Text className='ev-feature-desc'>找到你的专属色彩方案</Text>
            </View>
            <View className='ev-feature-card animate-fade-in-up' style={{ animationDelay: '80ms' }}>
              <View className='ev-feature-icon-wrap' style={{ background: 'linear-gradient(135deg, #D4F0E7, #B8E6D0)' }}>
                <Image src={icons['ruler']} className='ev-feature-icon' style={{width: '48rpx', height: '48rpx'}} />
              </View>
              <Text className='ev-feature-title'>适合版型</Text>
              <Text className='ev-feature-desc'>了解你的身材优势</Text>
            </View>
            <View className='ev-feature-card animate-fade-in-up' style={{ animationDelay: '160ms' }}>
              <View className='ev-feature-icon-wrap' style={{ background: 'linear-gradient(135deg, #FDE8D0, #FAD4A8)' }}>
                <Image src={icons['sparkles']} className='ev-feature-icon' style={{width: '48rpx', height: '48rpx'}} />
              </View>
              <Text className='ev-feature-title'>适合风格</Text>
              <Text className='ev-feature-desc'>定义你的穿搭人设</Text>
            </View>
          </View>

          {/* 开始按钮 */}
          <View className='ev-start-area'>
            <View className='ev-start-btn press-scale' onClick={handleStart}>
              <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['wand-sparkles']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='ev-start-btn-text'>开始全方位 AI 测评</Text></View>
            </View>
          </View>

          <View style={{ height: '60rpx' }} />
        </ScrollView>
      )}

      {/* ===== QUESTIONING: 问答态 ===== */}
      {state === 'questioning' && (
        <View className='ev-quiz'>
          {/* Progress */}
          <View className='ev-quiz-progress'>
            <View className='ev-quiz-progress-bar'>
              <View
                className='ev-quiz-progress-fill'
                style={{ width: `${((currentQ + 1) / QUIZ_QUESTIONS.length) * 100}%` }}
              />
            </View>
            <Text className='ev-quiz-progress-text'>
              {currentQ + 1} / {QUIZ_QUESTIONS.length}
            </Text>
          </View>

          {/* Question Card */}
          <View className='ev-quiz-card animate-fade-in-up' key={currentQ}>
            <Text className='ev-quiz-question'>{QUIZ_QUESTIONS[currentQ].question}</Text>
            <View className='ev-quiz-options'>
              {QUIZ_QUESTIONS[currentQ].options.map((opt, idx) => (
                <View
                  key={opt.key}
                  className='ev-quiz-option press-scale animate-fade-in-up'
                  style={{ animationDelay: `${idx * 60}ms` }}
                  onClick={() => handleAnswer(QUIZ_QUESTIONS[currentQ].id, opt.key)}
                >
                  <Image src={opt.icon} className='ev-quiz-option-icon' style={{width: '48rpx', height: '48rpx'}} />
                  <Text className='ev-quiz-option-label'>{opt.label}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}

      {/* ===== ANALYZING: 毛玻璃全屏解析 ===== */}
      {state === 'analyzing' && (
        <View className='ev-analyzing'>
          <View className='ev-analyzing-bg' />
          <View className='ev-analyzing-overlay' />
          <View className='ev-analyzing-content'>
            <View className='ev-analyzing-ring'>
              <View className='ev-analyzing-ring-inner' />
            </View>
            <Text className='ev-analyzing-title'>魔搭幻穿 AI 正在分析</Text>
            <Text className='ev-analyzing-text'>{analyzingText}</Text>
          </View>
        </View>
      )}

      {/* ===== RESULT: 风格报告 ===== */}
      {state === 'result' && report && (
        <ScrollView scrollY className='ev-result-scroll'>
          {/* Hero */}
          <View className='ev-result-hero'>
            <View className='ev-result-hero-bg' />
            <View className='ev-result-hero-content'>
              <Text className='ev-result-hero-label'>YOUR STYLE REPORT</Text>
              <Text className='ev-result-hero-title'>{report.styleName}</Text>
              <Text className='ev-result-hero-tag'>{report.styleTag}</Text>
            </View>
          </View>

          {/* 色彩建议 */}
          <View className='ev-card'>
            <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['palette']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='ev-card-title'>你的专属色彩</Text></View>
            <View className='ev-color-palette'>
              {report.colors.map((c) => (
                <View key={c.hex} className='ev-color-swatch'>
                  <View className='ev-color-circle' style={{ background: c.hex }} />
                  <Text className='ev-color-name'>{c.name}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* AI 点评 */}
          <View className='ev-card'>
            <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['message-circle']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='ev-card-title'>AI 风格点评</Text></View>
            <View className='ev-bubble ev-bubble--summary'>
              <Text className='ev-bubble-text'>{report.feedback}</Text>
            </View>
          </View>

          {/* 亮点 */}
          <View className='ev-card'>
            <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['sparkles']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='ev-card-title'>你的穿搭亮点</Text></View>
            {report.strengths.map((s, idx) => (
              <View key={idx} className='ev-bubble ev-bubble--strength'>
                <Text className='ev-bubble-text'>{s}</Text>
              </View>
            ))}
          </View>

          {/* 建议 */}
          <View className='ev-card'>
            <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['lightbulb']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='ev-card-title'>进阶建议</Text></View>
            {report.suggestions.map((s, idx) => (
              <View key={idx} className='ev-bubble ev-bubble--suggestion'>
                <Text className='ev-bubble-text'>{s}</Text>
              </View>
            ))}
          </View>

          {/* 操作 */}
          <View className='ev-result-actions'>
            <View className='ev-result-action-btn ev-result-action-btn--secondary press-scale' onClick={handleRetake}>
              <Text className='ev-result-action-text'>重新测评</Text>
            </View>
            <View className='ev-result-action-btn ev-result-action-btn--primary press-scale' onClick={() => Taro.switchTab({ url: '/pages/suggest/index' })}>
              <Text className='ev-result-action-text ev-result-action-text--primary'>去搭配</Text>
            </View>
          </View>

          <View style={{ height: '60rpx' }} />
        </ScrollView>
      )}
    </View>
  )
}
