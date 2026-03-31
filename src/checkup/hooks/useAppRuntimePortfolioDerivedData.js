import { usePortfolioDerivedData } from './usePortfolioDerivedData.js'
import { composePortfolioDerivedDataInput } from './useAppRuntimeComposer.js'

export function useAppRuntimePortfolioDerivedData({ data, helperFns, constants }) {
  return usePortfolioDerivedData(
    composePortfolioDerivedDataInput({
      data,
      helperFns,
      constants,
    })
  )
}
