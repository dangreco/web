<script lang="ts">
	import '../app.css';
	import { injectSpeedInsights } from '@vercel/speed-insights/sveltekit';
	import { injectAnalytics } from '@vercel/analytics/sveltekit'
	injectSpeedInsights();
	injectAnalytics();

	let { children } = $props();
</script>

{@render children()}
