const shouldFail = process.argv.includes('--fail');

for (let progress = 0; progress <= 100; progress += 20) {
  process.stdout.write(`Demo build ${progress}%\n`);
  await new Promise((resolve) => setTimeout(resolve, 350));
}

if (shouldFail) {
  process.stderr.write('Demo build failed: synthetic verification error.\n');
  process.exitCode = 1;
} else {
  process.stdout.write('Demo build completed.\n');
}
