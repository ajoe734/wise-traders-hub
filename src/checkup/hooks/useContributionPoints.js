// 貢獻積分系統 Hook
// 用於激勵使用者輸入數據和 thesis

import { useState, useEffect, useCallback, useMemo } from 'react'
import { OWNER_PORTFOLIO_ID, STORAGE_KEYS } from '../constants.js'

/**
 * Point rules
 */
export const POINT_RULES = {
  addThesis: 10, // 新增 thesis
  updateThesis: 5, // 更新 thesis
  addEvent: 5, // 新增事件
  updateEvent: 3, // 更新事件
  uploadScreenshot: 20, // 上傳截圖
  verifyData: 3, // 驗證資料正確性
  dailyCheckIn: 1, // 每日簽到
  completeResearch: 15, // 完成深度研究
}

/**
 * Level definitions
 */
export const LEVELS = [
  { level: 1, title: '新手', minPoints: 0 },
  { level: 2, title: '認真用戶', minPoints: 50 },
  { level: 3, title: '進階用戶', minPoints: 200 },
  { level: 4, title: '活躍用戶', minPoints: 500 },
  { level: 5, title: '貢獻大師', minPoints: 1000 },
  { level: 6, title: '策略專家', minPoints: 2000 },
]

/**
 * Rewards that can be redeemed with points
 */
export const REWARDS = {
  customTheme: {
    points: 200,
    description: '自訂主題顏色',
    type: 'feature',
  },
  advancedAnalytics: {
    points: 500,
    description: '進階分析圖表',
    type: 'feature',
  },
  prioritySupport: {
    points: 100,
    description: '優先技術支持',
    type: 'service',
  },
  exportData: {
    points: 300,
    description: '匯出完整數據',
    type: 'feature',
  },
}

/**
 * Read points from localStorage
 */
function readPointsFromStorage(userId = OWNER_PORTFOLIO_ID) {
  try {
    const key = `${STORAGE_KEYS.CONTRIBUTION_POINTS}-${userId}`
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : { points: 0, history: [], lastCheckIn: null }
  } catch {
    return { points: 0, history: [], lastCheckIn: null }
  }
}

/**
 * Save points to localStorage
 */
function savePointsToStorage(pointsData, userId = OWNER_PORTFOLIO_ID) {
  try {
    const key = `${STORAGE_KEYS.CONTRIBUTION_POINTS}-${userId}`
    localStorage.setItem(key, JSON.stringify(pointsData))
    return true
  } catch (err) {
    console.error('Failed to save points:', err)
    return false
  }
}

/**
 * Get current level from points
 */
export function getLevelFromPoints(points) {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (points >= LEVELS[i].minPoints) {
      return LEVELS[i]
    }
  }
  return LEVELS[0]
}

/**
 * Get progress to next level
 */
export function getLevelProgress(points) {
  const currentLevel = getLevelFromPoints(points)
  const currentIndex = LEVELS.findIndex((l) => l.level === currentLevel.level)

  if (currentIndex === LEVELS.length - 1) {
    return { current: points, next: null, percent: 100 }
  }

  const nextLevel = LEVELS[currentIndex + 1]
  const prevLevelMin = currentLevel.minPoints
  const nextLevelMin = nextLevel.minPoints

  const progress = points - prevLevelMin
  const total = nextLevelMin - prevLevelMin
  const percent = (progress / total) * 100

  return {
    current: points,
    next: nextLevel,
    percent: Math.round(percent),
  }
}

/**
 * Contribution Points Hook
 *
 * @param {string} userId - User ID
 * @returns {Object} Points methods and state
 */
export function useContributionPoints(userId = OWNER_PORTFOLIO_ID) {
  const [pointsData, setPointsData] = useState(() => readPointsFromStorage(userId))
  const [unlockedRewards, setUnlockedRewards] = useState([])

  // Load points on mount
  useEffect(() => {
    const loadData = async () => {
      const loaded = readPointsFromStorage(userId)
      setPointsData(loaded)

      // Load unlocked rewards
      const savedRewards = localStorage.getItem(`pf-unlocked-rewards-${userId}`)
      if (savedRewards) {
        setUnlockedRewards(JSON.parse(savedRewards))
      }
    }

    loadData()
  }, [userId])

  /**
   * Add points for an action
   */
  const addPoints = useCallback(
    async (actionType, description = '') => {
      const pointsEarned = POINT_RULES[actionType] || 0

      if (pointsEarned === 0) {
        return { success: false, error: '未知的行動類型' }
      }

      const newHistory = [
        ...(pointsData.history || []),
        {
          action: actionType,
          points: pointsEarned,
          description,
          timestamp: new Date().toISOString(),
        },
      ]

      // Keep only last 100 records
      const trimmedHistory = newHistory.slice(-100)

      const updated = {
        ...pointsData,
        points: pointsData.points + pointsEarned,
        history: trimmedHistory,
      }

      setPointsData(updated)
      const saved = savePointsToStorage(updated, userId)

      return {
        success: saved,
        pointsEarned,
        totalPoints: updated.points,
      }
    },
    [pointsData, userId]
  )

  /**
   * Daily check-in
   */
  const dailyCheckIn = useCallback(async () => {
    const today = new Date().toDateString()
    const lastCheckIn = pointsData.lastCheckIn
      ? new Date(pointsData.lastCheckIn).toDateString()
      : null

    if (lastCheckIn === today) {
      return { success: false, error: '今日已簽到', alreadyCheckedIn: true }
    }

    const result = await addPoints('dailyCheckIn', '每日簽到')

    if (result.success) {
      const updated = {
        ...pointsData,
        lastCheckIn: new Date().toISOString(),
      }
      setPointsData(updated)
      savePointsToStorage(updated, userId)
    }

    return result
  }, [pointsData, userId, addPoints])

  /**
   * Redeem a reward
   */
  const redeemReward = useCallback(
    async (rewardKey) => {
      const reward = REWARDS[rewardKey]

      if (!reward) {
        return { success: false, error: '未知的獎勵' }
      }

      if (pointsData.points < reward.points) {
        return {
          success: false,
          error: '積分不足',
          needed: reward.points - pointsData.points,
        }
      }

      if (unlockedRewards.includes(rewardKey)) {
        return { success: false, error: '已兌換過此獎勵' }
      }

      // Deduct points
      const updated = {
        ...pointsData,
        points: pointsData.points - reward.points,
        history: [
          ...(pointsData.history || []),
          {
            action: 'redeem_reward',
            points: -reward.points,
            description: `兌換：${reward.description}`,
            timestamp: new Date().toISOString(),
          },
        ],
      }

      setPointsData(updated)
      savePointsToStorage(updated, userId)

      // Unlock reward
      const newUnlocked = [...unlockedRewards, rewardKey]
      setUnlockedRewards(newUnlocked)
      localStorage.setItem(`pf-unlocked-rewards-${userId}`, JSON.stringify(newUnlocked))

      return { success: true, reward }
    },
    [pointsData, unlockedRewards, userId]
  )

  /**
   * Check if a reward is unlocked
   */
  const isRewardUnlocked = useCallback(
    (rewardKey) => {
      return unlockedRewards.includes(rewardKey)
    },
    [unlockedRewards]
  )

  /**
   * Get points summary
   */
  const summary = useMemo(() => {
    const currentLevel = getLevelFromPoints(pointsData.points)
    const progress = getLevelProgress(pointsData.points)

    const recentHistory = (pointsData.history || []).slice(-10)

    const pointsByAction = (pointsData.history || []).reduce((acc, item) => {
      acc[item.action] = (acc[item.action] || 0) + item.points
      return acc
    }, {})

    return {
      totalPoints: pointsData.points,
      currentLevel,
      progress,
      recentHistory,
      pointsByAction,
      checkInStreak: calculateCheckInStreak(pointsData.history),
    }
  }, [pointsData])

  return {
    // State
    points: pointsData.points,
    summary,
    unlockedRewards,

    // Methods
    addPoints,
    dailyCheckIn,
    redeemReward,
    isRewardUnlocked,
  }
}

/**
 * Calculate check-in streak
 */
function calculateCheckInStreak(history) {
  if (!history || history.length === 0) return 0

  const checkIns = history
    .filter((h) => h.action === 'dailyCheckIn')
    .map((h) => new Date(h.timestamp).toDateString())
    .sort((a, b) => new Date(b) - new Date(a))

  if (checkIns.length === 0) return 0

  let streak = 1
  const today = new Date().toDateString()

  for (let i = 1; i < checkIns.length; i++) {
    const prevDate = new Date(checkIns[i - 1])
    const currDate = new Date(checkIns[i])
    const diffDays = Math.round((prevDate - currDate) / (24 * 60 * 60 * 1000))

    if (diffDays === 1) {
      streak++
    } else if (diffDays > 1) {
      break
    }
  }

  // If last check-in was not today or yesterday, streak is broken
  const lastCheckIn = new Date(checkIns[0])
  const todayDate = new Date(today)
  const diffFromToday = Math.round((todayDate - lastCheckIn) / (24 * 60 * 60 * 1000))

  if (diffFromToday > 1) {
    return 0
  }

  return streak
}

/**
 * Points Display Component Helper
 */
export function PointsDisplay({ points, compact = false }) {
  const level = getLevelFromPoints(points)
  const progress = getLevelProgress(points)

  if (compact) {
    return (
      <div className="points-compact">
        <span className="points-value">{points}</span>
        <span className="points-level">{level.title}</span>
      </div>
    )
  }

  return (
    <div className="points-display">
      <div className="points-total">{points} pts</div>
      <div className="points-level">{level.title}</div>
      {progress.next && (
        <div className="points-progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
          </div>
          <span className="progress-text">
            距離 {progress.next.title} 還需 {progress.next.minPoints - points} pts
          </span>
        </div>
      )}
    </div>
  )
}
