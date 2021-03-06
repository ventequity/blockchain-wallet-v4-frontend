import { cancel, call, fork, put, race, select, take } from 'redux-saga/effects'
import { delay } from 'redux-saga'
import { any, equals, identity, isNil, path, prop } from 'ramda'
import { actions, actionTypes, selectors } from 'data'
import * as C from 'services/AlertService'

export default ({ api, coreSagas }) => {
  const logLocation = 'components/exchangeHistory/sagas'
  let pollingTradeStatusTask
  let fetchingTradesTask

  const updateTrade = function*(depositAddress) {
    try {
      const appState = yield select(identity)
      const currentTrade = selectors.core.kvStore.shapeShift
        .getTrade(depositAddress, appState)
        .getOrFail('Could not find trade.')
      const currentStatus = prop('status', currentTrade)
      if (
        equals('complete', currentStatus) ||
        equals('failed', currentStatus)
      ) {
        return
      }
      const data = yield call(api.getTradeStatus, depositAddress)
      const status = prop('status', data)
      const hashOut = prop('transaction', data)
      if (!equals(status, currentStatus)) {
        yield put(
          actions.core.kvStore.shapeShift.updateTradeMetadataShapeshift(
            depositAddress,
            status,
            hashOut
          )
        )
      }
    } catch (e) {
      yield put(actions.logs.logErrorMessage(logLocation, 'updateTrade', e))
    }
  }

  const startFetchingTrades = function*(trades) {
    for (let i = 0; i < trades.length; i++) {
      const trade = trades[i]
      try {
        const depositAddress = path(['quote', 'deposit'], trade)
        const status = prop('status', trade)
        const quote = prop('quote', trade)
        const depositAmount = prop('depositAmount', quote)
        const withdrawalAmount = prop('withdrawalAmount', quote)
        if (
          !equals('complete', status) ||
          any(isNil)([depositAmount, withdrawalAmount])
        ) {
          yield call(
            coreSagas.kvStore.shapeShift.fetchShapeshiftTrade,
            depositAddress
          )
          yield race({
            success: take(
              actionTypes.core.kvStore.shapeShift
                .FETCH_METADATA_SHAPESHIFT_SUCCESS
            ),
            failure: take(
              actionTypes.core.kvStore.shapeShift
                .FETCH_METADATA_SHAPESHIFT_FAILURE
            )
          })
        }
      } catch (e) {
        yield put(actions.alerts.displayError(C.EXCHANGE_REFRESH_TRADE_ERROR))
        yield put(
          actions.logs.logErrorMessage(logLocation, 'startFetchingTrades', e)
        )
      }
    }
  }

  const exchangeHistoryInitialized = function*(action) {
    try {
      const { trades } = action.payload
      fetchingTradesTask = yield fork(startFetchingTrades, trades)
    } catch (e) {
      yield put(actions.alerts.displayError(C.EXCHANGE_REFRESH_TRADES_ERROR))
      yield put(
        actions.logs.logErrorMessage(
          logLocation,
          'exchangeHistoryInitialized',
          e
        )
      )
    }
  }

  const exchangeHistoryDestroyed = function*(action) {
    try {
      yield cancel(fetchingTradesTask)
    } catch (e) {
      yield put(
        actions.logs.logErrorMessage(logLocation, 'exchangeHistoryDestroyed', e)
      )
    }
  }

  const startPollingTradeStatus = function*(depositAddress) {
    try {
      while (true) {
        yield call(updateTrade, depositAddress)
        yield call(delay, 5000)
      }
    } catch (e) {
      yield put(actions.alerts.displayError(C.EXCHANGE_REFRESH_TRADE_ERROR))
      yield put(
        actions.logs.logErrorMessage(logLocation, 'startPollingTradeStatus', e)
      )
    }
  }

  const exchangeHistoryModalInitialized = function*(action) {
    try {
      const { depositAddress } = action.payload
      pollingTradeStatusTask = yield fork(
        startPollingTradeStatus,
        depositAddress
      )
    } catch (e) {
      yield put(
        actions.logs.logErrorMessage(
          logLocation,
          'exchangeHistoryModalInitialized',
          e
        )
      )
    }
  }

  const exchangeHistoryModalDestroyed = function*() {
    try {
      yield cancel(pollingTradeStatusTask)
    } catch (e) {
      yield put(
        actions.logs.logErrorMessage(
          logLocation,
          'exchangeHistoryModalDestroyed',
          e
        )
      )
    }
  }

  return {
    exchangeHistoryInitialized,
    exchangeHistoryDestroyed,
    exchangeHistoryModalInitialized,
    exchangeHistoryModalDestroyed
  }
}
