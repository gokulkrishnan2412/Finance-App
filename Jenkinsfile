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
                '''
            }
        }

        stage('Build Image') {
            steps {
                sh '''
                    echo "Building Docker image..."
                    docker build -t "$IMAGE_NAME:$BUILD_NUMBER" .
                '''
            }
        }

        stage('Smoke Test') {
            steps {
                sh '''
                    set -e

                    echo "Removing old test container if it exists..."
                    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

                    echo "Starting test container..."
                    docker run -d \
                        --name "$CONTAINER_NAME" \
                        -p "$HOST_PORT:$CONTAINER_PORT" \
                        "$IMAGE_NAME:$BUILD_NUMBER"

                    echo "Waiting for application..."

                    for attempt in $(seq 1 30); do
                        echo "Attempt $attempt..."

                        if curl --fail --silent \
                            "http://127.0.0.1:$HOST_PORT/get_lendings" \
                            >/dev/null; then

                            echo "Smoke test passed!"
                            docker rm -f "$CONTAINER_NAME"
                            exit 0
                        fi

                        sleep 1
                    done

                    echo "Application did not become ready in time."

                    echo "Container logs:"
                    docker logs "$CONTAINER_NAME" || true

                    docker rm -f "$CONTAINER_NAME" || true

                    exit 1
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
        }
    }
}