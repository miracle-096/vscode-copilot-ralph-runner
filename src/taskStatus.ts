export type HarnessTaskSignalStatus = 'inprogress' | 'completed' | 'none';

export function parseTaskSignalStatus(rawValue: string | null | undefined): HarnessTaskSignalStatus {
	if (!rawValue) {
		return 'none';
	}

	const normalized = rawValue
		.toLowerCase()
		.replace(/[^a-z]+/g, '');

	if (normalized.includes('completed')) {
		return 'completed';
	}

	if (normalized.includes('inprogress')) {
		return 'inprogress';
	}

	return 'none';
}