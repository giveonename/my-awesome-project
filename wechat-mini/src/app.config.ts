export default defineAppConfig({
  subPackages: [],
  pages: [
    'pages/login/index',
    'pages/home/index',
    'pages/wardrobe/index',
    'pages/suggest/index',
    'pages/profile/index',
    'pages/history/index',
    'pages/item-detail/index',
    'pages/preferences/index',
    'pages/analytics/index',
    'pages/onboarding/index',
    'pages/chat/index',
    'pages/parse/index',
    'pages/diy/index',
    'pages/body-profile/index',
    'pages/community/index',
    'pages/community/detail',
    'pages/membership/index',
    'pages/outfit-detail/index',
    'pages/item-select/index',
  ],
  requiredPrivateInfos: ['getLocation'],
  permission: {
    'scope.userLocation': {
      desc: '用于获取您的位置以提供天气和穿搭推荐',
    },
  },
  tabBar: {
    custom: true,
    color: '#9E9EB8',
    selectedColor: '#5B4FC4',
    backgroundColor: '#FFFFFF',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/home/index',
        text: '首页',
      },
      {
        pagePath: 'pages/wardrobe/index',
        text: '衣橱',
      },
      {
        pagePath: 'pages/suggest/index',
        text: '搭配',
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
      },
    ],
  },
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#FFFFFF',
    navigationBarTitleText: 'Wardrowbe',
    navigationBarTextStyle: 'black',
    enablePullDownRefresh: false,
  },
})
