import { Component, PropsWithChildren } from 'react'
import Taro from '@tarojs/taro'
import { getAccessToken } from './utils/api'
import './app.scss'

class App extends Component<PropsWithChildren> {
  componentDidMount() {
    // Check for stored token on app launch
    const token = getAccessToken()
    if (!token) {
      // Redirect to login if no token found
      // Note: login page is already the first page in app.config.ts pages array
      // so this redirect is only needed if pages order changes
      console.log('No token found, user needs to login')
    }
  }

  componentDidShow() {
    // Check token validity on every app show
    const token = getAccessToken()
    if (!token) {
      // If user has no token and is not on login page, redirect to login
      const pages = Taro.getCurrentPages()
      const currentPage = pages[pages.length - 1]
      if (currentPage && !currentPage.route?.includes('login')) {
        Taro.reLaunch({ url: '/pages/login/index' })
      }
    }
  }

  componentDidHide() {}

  render() {
    return this.props.children
  }
}

export default App