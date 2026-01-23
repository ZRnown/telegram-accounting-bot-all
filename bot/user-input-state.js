// Shared input state for private chat workflows
const userInputStates = new Map()
const INPUT_TIMEOUT_MS = 5 * 60 * 1000

export function setUserInputState(userId, action, data = null) {
  if (!userId || !action) return
  userInputStates.set(String(userId), {
    action,
    data,
    timestamp: Date.now()
  })
}

export function getUserInputState(userId) {
  if (!userId) return null
  const key = String(userId)
  const state = userInputStates.get(key)
  if (!state) return null
  if (Date.now() - state.timestamp > INPUT_TIMEOUT_MS) {
    userInputStates.delete(key)
    return null
  }
  return state
}

export function clearUserInputState(userId, action = null) {
  if (!userId) return
  const key = String(userId)
  if (!action) {
    userInputStates.delete(key)
    return
  }
  const state = userInputStates.get(key)
  if (state?.action === action) {
    userInputStates.delete(key)
  }
}

export function hasPendingUserInput(userId) {
  return !!getUserInputState(userId)
}
