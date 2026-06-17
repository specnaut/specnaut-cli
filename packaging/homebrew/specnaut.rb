class Specnaut < Formula
  desc "Spec-driven CLI with auto-chain, review phase, and backlog sync"
  homepage "https://github.com/specnaut/specnaut-cli"
  version "0.1.0-alpha.1"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/specnaut/specnaut-cli/releases/download/v#{version}/specnaut-macos-arm64"
      sha256 "__REPLACE_AT_RELEASE_MACOS_ARM64__"
    end
    on_intel do
      url "https://github.com/specnaut/specnaut-cli/releases/download/v#{version}/specnaut-macos-x64"
      sha256 "__REPLACE_AT_RELEASE_MACOS_X64__"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/specnaut/specnaut-cli/releases/download/v#{version}/specnaut-linux-arm64"
      sha256 "__REPLACE_AT_RELEASE_LINUX_ARM64__"
    end
    on_intel do
      url "https://github.com/specnaut/specnaut-cli/releases/download/v#{version}/specnaut-linux-x64"
      sha256 "__REPLACE_AT_RELEASE_LINUX_X64__"
    end
  end

  def install
    bin.install Dir["*"].first => "specnaut"
  end

  test do
    assert_match "specnaut #{version}", shell_output("#{bin}/specnaut --version")
  end
end
