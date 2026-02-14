import {
	type Path,
	type RequestedRangeLock,
	type WholeFileLockOp,
	type FileLockManager,
} from './file-lock-manager';
import { logger } from '@php-wasm/logger';

// TODO: Add optional granular tracing
export class FileLockManagerComposite implements FileLockManager {
	nativeLockManager: FileLockManager;
	wasmLockManager: FileLockManager;

	constructor(
		nativeLockManager: FileLockManager,
		wasmLockManager: FileLockManager
	) {
		this.nativeLockManager = nativeLockManager;
		this.wasmLockManager = wasmLockManager;
	}

	lockWholeFile(path: Path, op: WholeFileLockOp): boolean {
		let nativeResult;
		let wasmResult;
		try {
			nativeResult = this.nativeLockManager.lockWholeFile(path, op);
			if (!nativeResult) {
				return false;
			}

			wasmResult = this.wasmLockManager.lockWholeFile(path, op);
		} catch (e) {
			logger.error('Unexpected error in lockWholeFile()', e);
		} finally {
			// Rollback the native lock if the wasm lock throws
			// (e.g. comlink-sync timeout). Without this, the native
			// lock would be held indefinitely, blocking all other
			// workers.
			if (nativeResult && !wasmResult) {
				// Rollback the native lock if the wasm lock fails.
				this.nativeLockManager.lockWholeFile(path, {
					...op,
					type: 'unlock',
				});
			}
		}

		return !!nativeResult && !!wasmResult;
	}

	lockFileByteRange(
		path: Path,
		requestedLock: RequestedRangeLock,
		waitForLock: boolean
	): boolean {
		let nativeResult;
		let wasmResult;
		try {
			nativeResult = this.nativeLockManager.lockFileByteRange(
				path,
				requestedLock,
				waitForLock
			);
			if (!nativeResult) {
				return false;
			}

			wasmResult = this.wasmLockManager.lockFileByteRange(
				path,
				requestedLock,
				waitForLock
			);
		} catch (e) {
			logger.error('Unexpected error in lockFileByteRange()', e);
		} finally {
			if (nativeResult && !wasmResult) {
				// Rollback the native lock if the wasm lock fails.
				this.nativeLockManager.lockFileByteRange(
					path,
					{
						...requestedLock,
						type: 'unlocked',
					},
					false
				);
			}
		}

		return !!nativeResult && !!wasmResult;
	}

	findFirstConflictingByteRangeLock(
		path: Path,
		desiredLock: RequestedRangeLock
	): Omit<RequestedRangeLock, 'fd'> | undefined {
		try {
			// Check native lock manager first, then wasm lock manager.
			// Return the first conflict found from either.
			const nativeConflict =
				this.nativeLockManager.findFirstConflictingByteRangeLock(
					path,
					desiredLock
				);
			if (nativeConflict) {
				return nativeConflict;
			}

			const wasmConflict =
				this.wasmLockManager.findFirstConflictingByteRangeLock(
					path,
					desiredLock
				);
			return wasmConflict;
		} catch (e) {
			logger.error(
				'Unexpected error in findFirstConflictingByteRangeLock()',
				e
			);
			return undefined;
		}
	}

	releaseLocksForProcess(pid: number): void {
		try {
			this.nativeLockManager.releaseLocksForProcess(pid);
		} catch (e) {
			logger.error(
				'Unexpected error in nativeLockManager.releaseLocksForProcess()',
				e
			);
		}

		try {
			this.wasmLockManager.releaseLocksForProcess(pid);
		} catch (e) {
			logger.error(
				'Unexpected error in wasmLockManager.releaseLocksForProcess()',
				e
			);
		}
	}

	releaseLocksOnFdClose(pid: number, fd: number, path: Path): void {
		try {
			this.nativeLockManager.releaseLocksOnFdClose(pid, fd, path);
		} catch (e) {
			logger.error(
				'Unexpected error in nativeLockManager.releaseLocksOnFdClose()',
				e
			);
		}

		try {
			this.wasmLockManager.releaseLocksOnFdClose(pid, fd, path);
		} catch (e) {
			logger.error(
				'Unexpected error in wasmLockManager.releaseLocksOnFdClose()',
				e
			);
		}
	}
}
