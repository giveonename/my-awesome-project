import { View, Text, ScrollView, Input, Image} from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState, useRef, useEffect, useCallback } from 'react'
import { api } from '../../utils/api'
import './index.scss'
import { icons } from '../../constants/icons'

interface OutfitSuggestion {
  headline?: string
  items?: string[]
  reasoning?: string
}

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  metadata?: {
    outfit_suggestions?: OutfitSuggestion[]
    confirmed_index?: number | null
  }
  created_at: string
}

const QUICK_STARTERS = [
  '今天穿什么好？',
  '我要去约会',
  '帮我搭配上班装',
  '周末出游穿搭',
  '这天气怎么穿？',
  '推荐显瘦的搭配',
]

const SESSION_KEY = 'chat_session_id'

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const initialized = useRef(false)

  useDidShow(() => {
    if (!initialized.current) {
      initialized.current = true
      initSession()
    }
  })

  // Auto-scroll to bottom when messages change
  const msgCount = useRef(0)
  useEffect(() => {
    if (messages.length > msgCount.current) {
      msgCount.current = messages.length
    }
  }, [messages])

  const initSession = async () => {
    if (sessionId) return

    // Try to restore cached session
    const cachedId = Taro.getStorageSync<string>(SESSION_KEY)
    if (cachedId) {
      try {
        // Load existing session messages
        const data = await api.get<any>(`/chat/sessions/${cachedId}/messages`)
        if (data.messages && data.messages.length > 0) {
          setSessionId(cachedId)
          const restored: Message[] = data.messages.map((m: any) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            metadata: m.metadata,
            created_at: m.created_at,
          }))
          setMessages(restored)
          return
        }
      } catch {
        // Session expired or not found, create new one
        Taro.removeStorageSync(SESSION_KEY)
      }
    }

    try {
      const session = await api.post<any>('/chat/sessions', {
        title: 'AI 穿搭对话',
      })
      setSessionId(session.id)
      Taro.setStorageSync(SESSION_KEY, session.id)

      // Add welcome system message
      const welcome: Message = {
        id: 'welcome',
        role: 'assistant',
        content: '你好呀！我是你的 AI 造型师「小衣」 ✨\n\n我了解你的衣橱、身材数据和当前天气，可以给你量身定制穿搭建议。\n\n随便聊聊你的穿搭需求吧！',
        created_at: new Date().toISOString(),
      }
      setMessages([welcome])
    } catch (err) {
      console.error('Failed to create chat session:', err)
    }
  }

  const sendMessage = async (text: string) => {
    if (!text.trim() || sending) return
    if (!sessionId) {
      await initSession()
    }
    if (!sessionId) return

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg])
    setInputText('')
    setSending(true)

    try {
      const res = await api.post<any>(`/chat/sessions/${sessionId}/message`, {
        content: text.trim(),
      })

      const aiMsg: Message = {
        id: res.ai_message.id,
        role: 'assistant',
        content: res.ai_message.content,
        metadata: res.ai_message.metadata,
        created_at: res.ai_message.created_at,
      }
      setMessages(prev => [...prev, aiMsg])
    } catch (err) {
      console.error('Chat error:', err)
      const errMsg: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: '暂时无法回复，稍后再试试？',
        created_at: new Date().toISOString(),
      }
      setMessages(prev => [...prev, errMsg])
    } finally {
      setSending(false)
    }
  }

  const handleSend = () => {
    sendMessage(inputText)
  }

  const handleQuickReply = (text: string) => {
    sendMessage(text)
  }

  const handleConfirmOutfit = (outfit: OutfitSuggestion) => {
    sendMessage(`就穿这套：${outfit.headline || '推荐方案'}`)
  }

  const handleClearChat = useCallback(async () => {
    const res = await Taro.showModal({
      title: '清空对话',
      content: '确定要清空所有对话记录吗？',
      confirmText: '清空',
      confirmColor: '#FF4136',
    })
    if (res.confirm) {
      Taro.removeStorageSync(SESSION_KEY)
      setSessionId(null)
      setMessages([])
      initialized.current = false
      initSession()
    }
  }, [])

  const renderOutfitCard = (outfit: OutfitSuggestion, idx: number) => (
    <View key={idx} className='outfit-card'>
      <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['shirt']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='outfit-card-title'>{outfit.headline || `方案 ${idx + 1}`}</Text></View>
      {outfit.items && (
        <View className='outfit-card-items'>
          {outfit.items.map((item, i) => (
            <View key={i} className='outfit-card-item'>
              <Text className='outfit-card-item-text'>{item}</Text>
            </View>
          ))}
        </View>
      )}
      {outfit.reasoning && (
        <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['lightbulb']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='outfit-card-reasoning'>{outfit.reasoning}</Text></View>
      )}
      <View className='outfit-card-actions'>
        <View className='outfit-card-btn outfit-card-btn--primary' onClick={() => handleConfirmOutfit(outfit)}>
          <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['thumbs-up']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='outfit-card-btn-text'>就穿这套</Text></View>
        </View>
        <View className='outfit-card-btn' onClick={() => sendMessage('换一套')}>
          <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['refresh-cw']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='outfit-card-btn-text outfit-card-btn-text--secondary'>换一套</Text></View>
        </View>
      </View>
    </View>
  )

  const renderMessage = (msg: Message) => {
    const isUser = msg.role === 'user'
    return (
      <View key={msg.id} className={`msg-row ${isUser ? 'msg-row--user' : 'msg-row--ai'}`}>
        {!isUser && <View className='msg-avatar'><Image src={icons['bot']} className='msg-avatar-text' style={{width: '48rpx', height: '48rpx'}} /></View>}
        <View className={`msg-bubble ${isUser ? 'msg-bubble--user' : 'msg-bubble--ai'}`}>
          <Text className='msg-text' user-select>{msg.content}</Text>
          {msg.metadata?.outfit_suggestions && msg.metadata.outfit_suggestions.length > 0 && (
            <View className='msg-outfits'>
              {msg.metadata.outfit_suggestions.map((outfit, i) => renderOutfitCard(outfit, i))}
            </View>
          )}
        </View>
      </View>
    )
  }

  return (
    <View className='chat-page'>
      {/* Header */}
      <View className='chat-header'>
        <View className='chat-header-back' onClick={() => Taro.navigateBack()}>
          <Text className='chat-header-back-text'>←</Text>
        </View>
        <View style={{display: 'flex', alignItems: 'center'}}><Image src={icons['bot']} style={{width: '36rpx', height: '36rpx', marginRight: '8rpx'}} /><Text className='chat-header-title'>AI 造型师</Text></View>
        <View className='chat-header-action' onClick={handleClearChat}>
          <Text className='chat-header-action-text'>清空</Text>
        </View>
      </View>

      {/* Messages */}
      <ScrollView scrollY className='chat-messages' scrollIntoView='chat-bottom' scrollWithAnimation>
        {messages.map(msg => renderMessage(msg))}
        {sending && (
          <View className='msg-row msg-row--ai'>
            <View className='msg-avatar'><Image src={icons['bot']} className='msg-avatar-text' style={{width: '48rpx', height: '48rpx'}} /></View>
            <View className='msg-bubble msg-bubble--ai'>
              <Text className='msg-typing'>正在思考中...</Text>
            </View>
          </View>
        )}
        <View id='chat-bottom' />
      </ScrollView>

      {/* Quick starters (only show when few messages) */}
      {messages.length <= 1 && (
        <View className='quick-starters'>
          {QUICK_STARTERS.map((text, i) => (
            <View key={i} className='quick-starter' onClick={() => handleQuickReply(text)}>
              <Text className='quick-starter-text'>{text}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Input bar */}
      <View className='chat-input-bar'>
        <View className='chat-input-wrap'>
          <Input
            className='chat-input'
            value={inputText}
            placeholder='说说你的穿搭需求...'
            placeholderClass='chat-input-placeholder'
            onInput={(e: any) => setInputText(e.detail.value)}
            onConfirm={handleSend}
            confirmType='send'
            disabled={sending}
            adjustPosition
          />
        </View>
        <View
          className={`chat-send-btn ${inputText.trim() ? 'chat-send-btn--active' : ''}`}
          onClick={handleSend}
        >
          <Text className='chat-send-text'>发送</Text>
        </View>
      </View>
    </View>
  )
}
