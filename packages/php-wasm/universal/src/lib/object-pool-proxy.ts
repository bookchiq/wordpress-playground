/**
 * Converts an object type to a promisified version where:
 * - Methods return `Promise<Awaited<ReturnType>>` (no double-wrapping)
 * - Properties become `Promise<Awaited<PropertyType>>`
 */
export type Promisified<T extends object> = {
	[K in keyof T]: T[K] extends (...args: infer A) => infer R
		? (...args: A) => Promise<Awaited<R>>
		: Promise<Awaited<T[K]>>;
};

/**
 * Creates a proxy that distributes method calls and property accesses
 * across a pool of object instances. Only one ongoing access per
 * instance is allowed at a time. If all instances are busy, accesses
 * wait until one becomes free.
 *
 * The returned proxy provides a promisified version of the original
 * interface: method calls and property accesses all return promises.
 */
export function createObjectPoolProxy<T extends object>(
	instances: T[]
): Promisified<T> {
	if (instances.length === 0) {
		throw new Error('At least one instance is required');
	}

	const freeInstances: T[] = [...instances];
	const waitQueue: Array<(instance: T) => void> = [];

	function acquire(): Promise<T> {
		const free = freeInstances.shift();
		if (free !== undefined) {
			return Promise.resolve(free);
		}
		return new Promise<T>((resolve) => {
			waitQueue.push(resolve);
		});
	}

	function release(instance: T): void {
		const waiter = waitQueue.shift();
		if (waiter) {
			waiter(instance);
		} else {
			freeInstances.push(instance);
		}
	}

	function withInstance<R>(fn: (instance: T) => R | Promise<R>): Promise<R> {
		return acquire().then((instance) => {
			let result: R | Promise<R>;
			try {
				result = fn(instance);
			} catch (e) {
				release(instance);
				throw e;
			}
			if (result != null && typeof (result as any).then === 'function') {
				return (result as Promise<R>).then(
					(val) => {
						release(instance);
						return val;
					},
					(err) => {
						release(instance);
						throw err;
					}
				);
			}
			release(instance);
			return result as R;
		});
	}

	return new Proxy({} as Promisified<T>, {
		get(_target, prop: string | symbol) {
			// Prevent the proxy from being treated as a thenable,
			// which would interfere with Promise resolution.
			if (prop === 'then') {
				return undefined;
			}

			const sampleValue = (instances[0] as any)[prop];

			if (typeof sampleValue === 'function') {
				return (...args: any[]) =>
					withInstance((inst) => (inst as any)[prop](...args));
			}

			return withInstance((inst) => (inst as any)[prop]);
		},
	});
}
