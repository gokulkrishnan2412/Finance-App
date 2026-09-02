pipeline {
    agent any

    environment {
        IMAGE_NAME = 'finance-app'
        CONTAINER_NAME = 'finance-app-ci'
        HOST_PORT = '5000'
        CONTAINER_PORT = '5000'
    }

    stages {

        stage('Validate') {
            steps {
                sh '''
                    echo "Validating Python code..."
                    python3 -m compileall -q backend
                    python3 -m pip install -r requirements.txt
                '''
            }
        }

        /*stage('Build Image') {
            steps {
                sh '''
                    echo "Building Docker image..."
                    docker build -t "$IMAGE_NAME:$BUILD_NUMBER" .
                '''
            }
        }*/

        stage('Smoke Test') {
            steps {
                sh '''
                    echo "Running backend smoke test..."
                    python3 -m pytest -q unit_test/test_backend.py
                '''
            }
        }

        stage('Install Node 20') {
            steps {
                sh '''
                    set -e
                    if ! command -v node >/dev/null 2>&1 || ! node -p "Number(process.versions.node.split('.')[0]) >= 20" | grep -q '^true$'; then
                        export NVM_DIR="$HOME/.nvm"
                        if [ ! -s "$NVM_DIR/nvm.sh" ]; then
                            curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
                        fi
                        . "$NVM_DIR/nvm.sh"
                        nvm install 20
                        nvm use 20
                    fi

                    node -v
                    npm -v
                '''
            }
        }

        stage('Unit Test') {
            steps {
                sh '''
                    set -e
                    echo "Running UI tests with Playwright..."
                    export NVM_DIR="$HOME/.nvm"
                    . "$NVM_DIR/nvm.sh"
                    nvm use 20

                    cd unit_test
                    npm install
                    npx playwright install --with-deps chromium
                    npx playwright test --reporter=line
                '''
            }
        }
    }

    post {
        always {
            sh '''
                echo "Cleaning up Docker resources..."
                docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
                docker rmi "$IMAGE_NAME:$BUILD_NUMBER" >/dev/null 2>&1 || true
            '''

            publishHTML(target: [
                allowMissing: true,
                alwaysLinkToLastBuild: true,
                keepAll: true,
                reportDir: 'unit_test/playwright-report',
                reportFiles: 'index.html',
                reportName: 'Playwright Report'
            ])
        }
    }
}